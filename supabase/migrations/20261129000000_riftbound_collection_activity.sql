-- Collection activity in the home feed (#303): collection rows keep only updated_at, so copies
-- added per member per day are counted here as they happen. Removals are not counted. Additive.

-- Not per server (a collection spans them), so no guild_id. Grows only: a day's row is
-- incremented, never lowered.
create table if not exists public.riftbound_collection_activity (
    user_id text not null,
    day date not null,
    copies_added integer not null check (copies_added > 0),
    updated_at timestamptz not null default now(),
    primary key (user_id, day)
);

-- RLS on and no policies: read through home_feed() only.
alter table public.riftbound_collection_activity enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.riftbound_collection_activity
    for each row execute function public.skip_forgotten();

-- One trigger instead of a line in each writer: set_riftbound_copies(), own_riftbound_playset(),
-- add_riftbound_copies() and import_riftbound_collection() all insert or update quantity.
create function public.count_riftbound_collection_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare added integer := new.quantity - case when tg_op = 'UPDATE' then old.quantity else 0 end;
begin
    if added > 0 then
        insert into public.riftbound_collection_activity as a (user_id, day, copies_added)
        values (new.user_id, current_date, added)
        on conflict (user_id, day) do update set copies_added = a.copies_added + excluded.copies_added, updated_at = now();
    end if;
    return null;
end;
$$;

revoke execute on function public.count_riftbound_collection_activity() from public, anon, authenticated;

create trigger count_activity after insert or update of quantity on public.riftbound_collection
    for each row execute function public.count_riftbound_collection_activity();

-- Settings: on by default; off hides the member's items, past and future, from every feed.
alter table public.profiles add column if not exists feed_collection boolean not null default true;

create function public.set_feed_collection(p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id();
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    insert into public.profiles (user_id, feed_collection) values (me, coalesce(p_on, true))
    on conflict (user_id) do update set feed_collection = excluded.feed_collection, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_feed_collection(boolean) from public, anon;
grant execute on function public.set_feed_collection(boolean) to authenticated;

-- The home feed (#302) as before, plus collection activity under Riftbound.
create or replace function public.home_feed(p_filter text default 'all')
returns table (kind text, happened_at timestamptz, guild_id text, guild_name text, user_id text, user_name text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select public.current_discord_id() as id
    ),
    mine as (
        select g.guild_id, g.name, coalesce(s.timezone, 'UTC') as tz
        from me
        join public.guild_members gm on gm.user_id = me.id
        join public.guilds g on g.guild_id = gm.guild_id
        left join public.guild_settings s on s.guild_id = g.guild_id
    ),
    -- Everyone sharing a server with the caller, once, labelled with the server of their latest name.
    people as (
        select distinct on (m.user_id) m.user_id, m.display_name, mine.guild_id, mine.name as guild_name, mine.tz,
            public.can_see_profile(m.user_id) as profile
        from mine
        join public.guild_members gm on gm.guild_id = mine.guild_id
        join public.members m on m.guild_id = gm.guild_id and m.user_id = gm.user_id
        where not exists (select from public.members h where h.user_id = m.user_id and h.hidden)
        order by m.user_id, m.updated_at desc, mine.guild_id
    ),
    -- A party's name for For you, from a server where they are not hidden; null when hidden everywhere.
    party as (
        select distinct on (x.user_id) x.user_id, x.display_name from public.members x
        where not x.hidden
        order by x.user_id, x.updated_at desc
    ),
    for_you as (
        select 'request' as kind, r.created_at as happened_at, null::text as guild_id, null::text as guild_name,
            r.borrower_id as user_id, pa.display_name as user_name,
            jsonb_build_object('cards', (select sum(c.quantity) from public.riftbound_borrow_request_cards c where c.request_id = r.id)) as data
        from me
        join public.riftbound_borrow_requests r on r.lender_id = me.id
        left join party pa on pa.user_id = r.borrower_id
        where public.riftbound_borrow_request_state(r.id) = 'open'
        union all
        select 'confirm', l.created_at, null, null, l.lender_id, pa.display_name,
            jsonb_build_object('cards', (select sum(c.quantity) from public.riftbound_loan_cards c where c.loan_id = l.id))
        from me
        join public.riftbound_loans l on l.borrower_id = me.id
        left join party pa on pa.user_id = l.lender_id
        where public.riftbound_loan_state(l.id) = 'open'
            and not exists (
                select from public.riftbound_loan_entries e
                where e.loan_id = l.id and e.kind in ('confirmed', 'disputed')
                    and not exists (select from public.riftbound_loan_entries x where x.replaces = e.id)
            )
        union all
        select 'overdue', l.due_on::timestamptz, null, null, o.id, pa.display_name,
            jsonb_build_object('lent', l.lender_id = me.id, 'due_on', l.due_on)
        from me
        join public.riftbound_loans l on me.id in (l.lender_id, l.borrower_id)
        cross join lateral (select case when l.lender_id = me.id then l.borrower_id else l.lender_id end as id) o
        left join party pa on pa.user_id = o.id
        where l.due_on < current_date and public.riftbound_loan_state(l.id) = 'open'
        union all
        select 'trade', max(t.notified_at), p.guild_id, p.guild_name, t.trader_id, p.display_name,
            jsonb_build_object('cards', count(*))
        from me
        join public.riftbound_trade_matches t on t.user_id = me.id
        join people p on p.user_id = t.trader_id
        where t.notified_at > now() - interval '14 days' and p.profile
        group by t.trader_id, p.guild_id, p.guild_name, p.display_name
    ),
    upcoming as (
        select e.created_at, e.starts_at, mine.guild_id, mine.name as guild_name,
            jsonb_build_object('name', e.name, 'starts_at', e.starts_at, 'url', e.url, 'store', s.name, 'city', s.city,
                'going', coalesce((
                    select jsonb_agg(m.display_name order by m.display_name)
                    from public.event_attendees a
                    join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
                    where a.event_id = e.id
                ), '[]')) as data
        from mine
        join public.events e on e.guild_id = mine.guild_id
        left join public.stores s on s.id = e.store_id
        where e.starts_at > now()
    ),
    happening as (
        select 'event' as kind, u.created_at as happened_at, u.guild_id, u.guild_name, null::text as user_id,
            null::text as user_name, u.data
        from upcoming u
        where u.created_at > now() - interval '30 days'
        union all
        -- Again a day before it starts.
        select 'event_soon', u.starts_at - interval '24 hours', u.guild_id, u.guild_name, null, null, u.data
        from upcoming u
        where u.starts_at - interval '24 hours' <= now()
        union all
        select 'deck', v.saved_at, p.guild_id, p.guild_name, d.user_id, p.display_name,
            jsonb_build_object('deck', d.id, 'name', d.name, 'version', v.version)
        from people p
        join public.riftbound_decks d on d.user_id = p.user_id
        join public.riftbound_deck_versions v on v.deck_id = d.id
        where v.saved_at > now() - interval '30 days' and public.can_see_deck(d.user_id, d.visibility)
        union all
        -- The bot's share command makes a deck visible without saving a version: a change newer than its latest.
        select 'deck_shared', d.updated_at, p.guild_id, p.guild_name, d.user_id, p.display_name,
            jsonb_build_object('deck', d.id, 'name', d.name)
        from people p
        join public.riftbound_decks d on d.user_id = p.user_id
        where d.updated_at > now() - interval '30 days' and public.can_see_deck(d.user_id, d.visibility)
            and d.updated_at > (select max(v.saved_at) from public.riftbound_deck_versions v where v.deck_id = d.id)
        union all
        select 'catalogue', c.decided_at, null, null, null, null, jsonb_build_object('cards', c.added)
        from me
        join public.riftbound_catalogue_proposals c on c.status = 'accepted' and c.added > 0
        where me.id is not null and c.decided_at > now() - interval '30 days'
        union all
        select 'recap', r.posted_at, mine.guild_id, mine.name, null, null, jsonb_build_object('month', r.month)
        from mine
        join public.monthly_recaps r on r.guild_id = mine.guild_id
        where r.posted_at > now() - interval '30 days'
        union all
        -- Copies added per day (#303), unless the member turned it off on Settings.
        select 'collection', a.updated_at, p.guild_id, p.guild_name, a.user_id, p.display_name,
            jsonb_build_object('day', a.day, 'cards', a.copies_added)
        from people p
        join public.riftbound_collection_activity a on a.user_id = p.user_id
        left join public.profiles pr on pr.user_id = p.user_id
        where a.day > current_date - 30 and p.profile and coalesce(pr.feed_collection, true)
        union all
        -- A change from the rank before it on the same linked account; the first row is a baseline.
        select 'rank', c.changed_at, p.guild_id, p.guild_name, c.user_id, p.display_name,
            jsonb_build_object('queue', c.queue, 'to', jsonb_build_object('tier', c.tier, 'division', c.division, 'lp', c.lp),
                'from', c.prev)
        from people p
        join public.game_accounts a on a.user_id = p.user_id and a.game = 'lol'
        join (
            select x.*, lag(jsonb_build_object('tier', x.tier, 'division', x.division, 'lp', x.lp))
                over (partition by x.user_id, x.puuid, x.queue order by x.changed_at, x.id) as prev
            from public.lol_rank_changes x
            where x.user_id in (select user_id from people)
        ) c on c.user_id = p.user_id and c.puuid = a.external_id
        where c.prev is not null and c.changed_at > now() - interval '30 days' and p.profile
        union all
        -- Games per week (Monday, in the label server's time zone) on the linked account.
        select 'lol_week', max(x.played_at), p.guild_id, p.guild_name, p.user_id, p.display_name,
            jsonb_build_object('week', w.week, 'this_week', w.week = date_trunc('week', now() at time zone p.tz)::date,
                'games', count(*), 'champion', mode() within group (order by x.champion))
        from people p
        join public.game_accounts a on a.user_id = p.user_id and a.game = 'lol'
        join public.lol_matches x on x.user_id = p.user_id and x.puuid = a.external_id
        cross join lateral (select date_trunc('week', x.played_at at time zone p.tz)::date as week) w
        where x.played_at > now() - interval '35 days' and p.profile
            and w.week > (now() at time zone p.tz)::date - 35
        group by p.user_id, p.display_name, p.guild_id, p.guild_name, p.tz, w.week
    )
    select * from for_you
    union all
    (
        select * from happening h
        where p_filter = 'all' or p_filter = case
            when h.kind in ('rank', 'lol_week') then 'league' when h.kind = 'recap' then 'server' else 'riftbound' end
        order by h.happened_at desc limit 500
    );
$$;

revoke execute on function public.home_feed(text) from public, anon;
grant execute on function public.home_feed(text) to authenticated;
