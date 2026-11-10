-- A weekly funnel for the Riftbound tools (#349), for the owner only: counts, no ids or names.
-- Additive.

-- guild_members had no timestamp, so "first shared a server" had none. Null for rows from
-- before this column, not a guessed date; new rows get the time the bot saw the member.
alter table public.guild_members add column if not exists created_at timestamptz;
alter table public.guild_members alter column created_at set default now();

-- Activity counts additions only, so it cannot tell when a collection held ten copies. This
-- records the first time it does, from now on.
create table if not exists public.riftbound_ten_copies (
    user_id text primary key,
    reached_at timestamptz
);

-- RLS on and no policies: read through riftbound_funnel() only.
alter table public.riftbound_ten_copies enable row level security;

create trigger skip_forgotten before insert on public.riftbound_ten_copies
    for each row execute function public.skip_forgotten();

-- Collections already at ten reached it on an unknown date: a null, not a guess, so their next
-- change is not taken for the crossing.
insert into public.riftbound_ten_copies (user_id, reached_at)
select c.user_id, null from public.riftbound_collection c group by c.user_id having sum(c.quantity) >= 10
on conflict (user_id) do nothing;

-- Below ten a collection has at most nine rows, so the sum stays cheap until the row exists.
create function public.record_riftbound_ten_copies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (select from public.riftbound_ten_copies t where t.user_id = new.user_id)
        and (select sum(c.quantity) from public.riftbound_collection c where c.user_id = new.user_id) >= 10 then
        insert into public.riftbound_ten_copies (user_id, reached_at) values (new.user_id, now())
        on conflict (user_id) do nothing;
    end if;
    return null;
end;
$$;

revoke execute on function public.record_riftbound_ten_copies() from public, anon, authenticated;

create trigger record_ten_copies after insert or update of quantity on public.riftbound_collection
    for each row execute function public.record_riftbound_ten_copies();

-- One row per ISO week (Monday, UTC) of the last 12, with the people who first reached each
-- step that week. Forgotten users (/forget-me) are left out: their rows are deleted, and
-- their auth user, which stays, is skipped by its hash.
create function public.riftbound_funnel()
returns table (week date, logged_in bigint, first_card bigint, ten_cards bigint,
    shares_server bigint, first_loan_or_trade bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with logins as (
        select i.provider_id as user_id, (min(u.created_at) at time zone 'utc')::date as at
        from auth.users u
        join auth.identities i on i.user_id = u.id and i.provider = 'discord'
        where not exists (select from public.forgotten_users f where f.user_hash = public.user_hash(i.provider_id))
        group by i.provider_id
    ),
    first_cards as (
        select a.user_id, min(a.day) as at from public.riftbound_collection_activity a group by a.user_id
    ),
    ten_cards as (
        select t.user_id, (t.reached_at at time zone 'utc')::date as at
        from public.riftbound_ten_copies t where t.reached_at is not null
    ),
    -- Both people have a collection. A null created_at predates the column, so it is before
    -- the other's known one and greatest() may skip it; with both null the date is unknown.
    shares as (
        select me.user_id, min(greatest((me.created_at at time zone 'utc')::date,
            (other.created_at at time zone 'utc')::date, mc.at, oc.at)) as at
        from public.guild_members me
        join public.guild_members other on other.guild_id = me.guild_id and other.user_id <> me.user_id
        join first_cards mc on mc.user_id = me.user_id
        join first_cards oc on oc.user_id = other.user_id
        where coalesce(me.created_at, other.created_at) is not null
        group by me.user_id
    ),
    deals as (
        select d.user_id, (min(d.at) at time zone 'utc')::date as at
        from (
            select l.lender_id as user_id, l.created_at as at from public.riftbound_loans l
            union all select l.borrower_id, l.created_at from public.riftbound_loans l
            union all select m.user_id, m.notified_at from public.riftbound_trade_matches m
            union all select m.trader_id, m.notified_at from public.riftbound_trade_matches m
        ) d
        group by d.user_id
    ),
    steps as (
        select 'logged_in' as step, at from logins
        union all select 'first_card', at from first_cards
        union all select 'ten_cards', at from ten_cards
        union all select 'shares_server', at from shares
        union all select 'first_loan_or_trade', at from deals
    ),
    weeks as (
        select w::date as week
        from generate_series(date_trunc('week', now() at time zone 'utc') - interval '11 weeks',
            date_trunc('week', now() at time zone 'utc'), interval '1 week') w
    )
    select w.week,
        count(*) filter (where s.step = 'logged_in'),
        count(*) filter (where s.step = 'first_card'),
        count(*) filter (where s.step = 'ten_cards'),
        count(*) filter (where s.step = 'shares_server'),
        count(*) filter (where s.step = 'first_loan_or_trade')
    from weeks w
    left join steps s on date_trunc('week', s.at::timestamp)::date = w.week
    group by w.week
    order by w.week;
$$;

revoke execute on function public.riftbound_funnel() from public, anon, authenticated;
grant execute on function public.riftbound_funnel() to service_role;
