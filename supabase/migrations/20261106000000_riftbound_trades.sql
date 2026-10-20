-- Riftbound trade matching (#178): one member's wishlist against another's cards marked for
-- trade (riftbound_collection.for_trade), within a server they share, with a place to meet.
-- No prices: the bot introduces people, the trade happens at the table. Additive, except
-- profile_wishlist() and forget_user(), which keep their signatures.

-- The matches the bot has DMed about, so each is told once. Per user like the wishlist it
-- comes from, so no guild_id: two shared servers are still one match.
create table if not exists public.riftbound_trade_matches (
    -- Who wants the card, the one told.
    user_id text not null,
    -- Who has it for trade; forget_user() deletes by this column too.
    trader_id text not null,
    -- No cascade: replacing the catalogue must not make old matches new again.
    card_id text not null references public.riftbound_cards (id),
    notified_at timestamptz not null default now(),
    primary key (user_id, trader_id, card_id)
);

-- Nobody reads it but the bot, with the secret key.
alter table public.riftbound_trade_matches enable row level security;

create trigger skip_forgotten before insert on public.riftbound_trade_matches
    for each row execute function public.skip_forgotten();

-- Where two members of server g could meet: an upcoming event both are going to, else a store
-- both are regulars of, else a store in a city where they play (both of them first). Store
-- name and city only, never an address. Callers make sure neither is hidden in g.
create or replace function public.riftbound_meeting_place(g text, a text, b text)
returns table (kind text, event_name text, starts_at timestamptz, store_name text, store_city text)
language sql
stable
security invoker
set search_path = ''
as $$
    select p.kind, p.event_name, p.starts_at, p.store_name, p.store_city from (
        (select 1 as rank, 'event' as kind, e.name as event_name, e.starts_at, s.name as store_name, s.city as store_city
         from public.events e
         left join public.stores s on s.id = e.store_id
         join public.event_attendees x on x.event_id = e.id and x.user_id = a
         join public.event_attendees y on y.event_id = e.id and y.user_id = b
         where e.guild_id = g and e.starts_at >= now()
         order by e.starts_at
         limit 1)
        union all
        (select 2, 'regulars', null, null, s.name, s.city
         from public.stores s
         join public.store_regulars x on x.store_id = s.id and x.user_id = a
         join public.store_regulars y on y.store_id = s.id and y.user_id = b
         where s.guild_id = g
         order by s.name
         limit 1)
        union all
        (select 3, 'city', null, null, s.name, s.city
         from public.stores s
         cross join lateral (
             select count(distinct r.user_id) as players, bool_or(r.store_id = s.id) as here
             from public.store_regulars r
             join public.stores rs on rs.id = r.store_id
             where r.guild_id = g and r.user_id in (a, b) and rs.city = s.city
         ) c
         where s.guild_id = g and c.players > 0
         order by c.players desc, c.here desc, s.name
         limit 1)
    ) p
    order by p.rank
    limit 1;
$$;

revoke execute on function public.riftbound_meeting_place(text, text, text) from public, anon, authenticated;
grant execute on function public.riftbound_meeting_place(text, text, text) to service_role;

-- profile_wishlist()'s rows without the visibility check, for the bot's DMs (which have no
-- visitor) and profile_wishlist() itself. Body as in 20261105000000_riftbound_wishlist.sql.
create or replace function public.riftbound_wish_rows(u text)
returns table (card_id text, printing_id text, language text, deck integer, decks integer, manual integer, copies jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
    with per_deck as (
        select d.id, d.wishlist_mode, x.card_id, x.printing_id,
            case when d.allow_other_languages then null else d.language::text end as language, sum(x.quantity) as q
        from public.riftbound_decks d
        cross join lateral (
            select c.card_id, c.printing_id, c.quantity from public.riftbound_deck_cards c where c.deck_id = d.id
            union all
            select d.legend_id, null, 1 where d.legend_id is not null
        ) x
        where d.user_id = u and d.wishlist_mode <> 'none'
        group by d.id, d.wishlist_mode, x.card_id, x.printing_id, 5
    ),
    wants as (
        select w.card_id, w.printing_id, w.language, null::integer as deck, sum(w.q)::integer as decks, null::integer as manual
        from per_deck w
        where w.wishlist_mode = 'dedicated'
        group by w.card_id, w.printing_id, w.language
        union all
        select w.card_id, w.printing_id, w.language, dense_rank() over (partition by w.card_id order by w.id)::integer,
            w.q::integer, null
        from per_deck w
        where w.wishlist_mode = 'shared'
        union all
        select w.card_id, w.printing_id, null, null, 0, w.quantity from public.riftbound_wishlist w where w.user_id = u
    )
    select w.card_id, w.printing_id, w.language, w.deck, max(w.decks)::integer, max(w.manual)::integer,
        coalesce((
            select jsonb_agg(jsonb_build_object('printing_id', o.printing_id, 'language', o.language, 'quantity', o.quantity))
            from (
                select c.printing_id, c.language::text as language, sum(c.quantity)::integer as quantity
                from public.riftbound_collection c
                join public.riftbound_printings p on p.id = c.printing_id
                where c.user_id = u and p.card_id = w.card_id
                group by c.printing_id, c.language
            ) o
        ), '[]')
    from wants w
    group by w.card_id, w.printing_id, w.language, w.deck
    order by w.card_id, w.deck nulls first, w.printing_id nulls last, w.language nulls last;
$$;

revoke execute on function public.riftbound_wish_rows(text) from public, anon, authenticated;
grant execute on function public.riftbound_wish_rows(text) to service_role;

create or replace function public.profile_wishlist(u text)
returns table (card_id text, printing_id text, language text, deck integer, decks integer, manual integer, copies jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select * from public.riftbound_wish_rows(u) where public.can_see_profile(u);
$$;

-- The server's Trades page: the other members of `guild` with copies of p_cards (the visitor's
-- wanted cards) for trade, per printing and language, and where the visitor could meet them.
-- Only members whose profile is not private and whom the visitor may see (can_see_profile()
-- also leaves out anyone hidden with /hide-me), like card_lenders().
create or replace function public.guild_trade_offers(guild text, p_cards text[])
returns table (user_id text, display_name text, avatar_url text, card_id text, printing_id text, language text,
    copies integer, place_kind text, event_name text, starts_at timestamptz, store_name text, store_city text)
language sql
stable
security definer
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, t.card_id, t.printing_id, t.language, t.copies,
        place.kind, place.event_name, place.starts_at, place.store_name, place.store_city
    from public.members m
    join public.guild_members gm on gm.guild_id = m.guild_id and gm.user_id = m.user_id
    join public.profiles pr on pr.user_id = m.user_id and pr.visibility <> 'private'
    cross join lateral (
        select p.card_id, c.printing_id, c.language::text as language, sum(c.for_trade)::integer as copies
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        where c.user_id = m.user_id and c.for_trade > 0 and p.card_id = any (p_cards)
        group by p.card_id, c.printing_id, c.language
    ) t
    left join lateral public.riftbound_meeting_place(guild, public.current_discord_id(), m.user_id) place on true
    where m.guild_id = guild and not m.hidden and m.user_id <> public.current_discord_id()
        and public.is_guild_member(guild) and public.can_see_profile(m.user_id)
    order by t.card_id, m.display_name, t.printing_id, t.language;
$$;

revoke execute on function public.guild_trade_offers(text, text[]) from public;
grant execute on function public.guild_trade_offers(text, text[]) to authenticated;

-- The bot's hourly DMs: per server, wanter and trader the copies for trade of cards on the
-- wanter's wishlist (an entry or a deck that counts, before what they own: the bot works out
-- what is still wanted with wishlist()), not DMed about yet. The trader as can_see_profile()
-- would show them to the wanter: not private, hidden nowhere. Neither hidden in the server.
create or replace function public.riftbound_trade_candidates()
returns table (guild_id text, user_id text, trader_id text, card_id text, printing_id text, language text,
    copies integer, place_kind text, event_name text, starts_at timestamptz, store_name text, store_city text)
language sql
stable
security invoker
set search_path = ''
as $$
    with wishes as (
        select w.user_id, w.card_id from public.riftbound_wishlist w
        union
        select d.user_id, c.card_id from public.riftbound_decks d
        join public.riftbound_deck_cards c on c.deck_id = d.id
        where d.wishlist_mode <> 'none'
        union
        select d.user_id, d.legend_id from public.riftbound_decks d
        where d.wishlist_mode <> 'none' and d.legend_id is not null
    ),
    offers as (
        select c.user_id, p.card_id, c.printing_id, c.language::text as language, sum(c.for_trade)::integer as copies
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        join public.profiles pr on pr.user_id = c.user_id and pr.visibility <> 'private'
        where c.for_trade > 0 and not exists (select from public.members h where h.user_id = c.user_id and h.hidden)
        group by c.user_id, p.card_id, c.printing_id, c.language
    )
    select a.guild_id, w.user_id, o.user_id, o.card_id, o.printing_id, o.language, o.copies,
        place.kind, place.event_name, place.starts_at, place.store_name, place.store_city
    from wishes w
    join offers o on o.card_id = w.card_id and o.user_id <> w.user_id
    join public.guild_members a on a.user_id = w.user_id
    join public.guild_members b on b.guild_id = a.guild_id and b.user_id = o.user_id
    left join lateral public.riftbound_meeting_place(a.guild_id, w.user_id, o.user_id) place on true
    where not exists (
            select from public.members h
            where h.guild_id = a.guild_id and h.user_id in (w.user_id, o.user_id) and h.hidden
        )
        and not exists (
            select from public.riftbound_trade_matches t
            where t.user_id = w.user_id and t.trader_id = o.user_id and t.card_id = o.card_id
        )
    order by w.user_id, o.user_id, o.card_id, a.guild_id, o.printing_id, o.language;
$$;

revoke execute on function public.riftbound_trade_candidates() from public, anon, authenticated;
grant execute on function public.riftbound_trade_candidates() to service_role;

-- As in 20261101000000_riftbound_loans.sql, plus the matches where the user is the trader:
-- the loop below finds only user_id columns.
create or replace function public.forget_user(member text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare t text;
begin
    perform public.lock_user(member, true);
    insert into public.forgotten_users (user_hash) values (public.user_hash(member))
    on conflict (user_hash) do nothing;
    perform set_config('ni_han_bao.erase_loans', 'on', true);
    delete from public.riftbound_loans where member in (lender_id, borrower_id);
    perform set_config('ni_han_bao.erase_loans', 'off', true);
    delete from public.riftbound_trade_matches where trader_id = member;
    for t in
        select c.relname::text
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'user_id' and not a.attisdropped
        order by c.relname = 'members', c.relname
    loop
        execute format('delete from public.%I where user_id = $1', t) using member;
    end loop;
    update public.stores set added_by = null where added_by = member;
end;
$$;
