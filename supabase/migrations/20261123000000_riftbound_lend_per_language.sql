-- Who has it? per language (#296): copies to lend counted per language after decks not for
-- lending hold theirs and open loans, so no language is listed without a free copy. Replaces
-- riftbound_deck_held(), riftbound_free_to_lend(), riftbound_card_lenders(), card_lenders(),
-- riftbound_lend_options() and my_riftbound_lend_options() (other columns), which the code
-- shipping with this migration reads, as 20261107000000_riftbound_deck_lending.sql did.

drop function public.card_lenders(text);
drop function public.riftbound_card_lenders(text[], text[], text);
drop function public.riftbound_free_to_lend(text, text[], text);
drop function public.my_riftbound_lend_options(text[]);
drop function public.riftbound_lend_options(text, text[], bigint);
drop function public.riftbound_deck_held(text);

-- Copies of each card a member's decks marked not for lending hold, per deck language: each
-- deck's Legend and entries, added up, since each of those decks stays built.
create function public.riftbound_deck_held(p_user text)
returns table (card_id text, language text, held bigint)
language sql
stable
set search_path = ''
as $$
    select x.card_id, d.language::text, sum(x.quantity)::bigint
    from public.riftbound_decks d
    cross join lateral (
        select d.legend_id as card_id, 1 as quantity where d.legend_id is not null
        union all
        select c.card_id, c.quantity from public.riftbound_deck_cards c where c.deck_id = d.id
    ) x
    where d.user_id = p_user and d.not_for_lending
    group by x.card_id, d.language;
$$;

-- Per card and language, the copies a member has in hand (owned, not out on a loan) and how
-- many of them their decks not for lending hold. Decks hold copies of a card, not of a
-- language: each takes its own language's first, then the others in alphabetical order (en,
-- fr, zh-Hans). As heldByLanguage() in bot/src/lend-copies.ts.
create function public.riftbound_held_in_hand(p_user text)
returns table (card_id text, language text, in_hand bigint, held bigint)
language sql
stable
set search_path = ''
as $$
    with hand as (
        select p.card_id, c.language::text as language, sum(greatest(c.quantity - coalesce(o.lent, 0), 0))::bigint as n
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        left join public.riftbound_lent_out(p_user) o on o.printing_id = c.printing_id and o.finish = c.finish
            and o.condition = c.condition and o.language = c.language::text
        where c.user_id = p_user
        group by p.card_id, c.language
    ),
    d as (select * from public.riftbound_deck_held(p_user)),
    own as (
        select h.card_id, h.language, h.n, least(h.n, coalesce(d.held, 0)) as own
        from hand h
        left join d on d.card_id = h.card_id and d.language = h.language
    ),
    rest as (
        -- What the decks hold that their own languages could not, and the room left before
        -- each language, in order.
        select o.*,
            coalesce((select sum(d.held) from d where d.card_id = o.card_id), 0) - sum(o.own) over (partition by o.card_id) as spill,
            coalesce(sum(o.n - o.own) over (partition by o.card_id order by o.language collate "C"
                rows between unbounded preceding and 1 preceding), 0) as ahead
        from own o
    )
    select r.card_id, r.language, r.n, (r.own + least(r.n - r.own, greatest(r.spill - r.ahead, 0)))::bigint
    from rest r;
$$;

-- What a member offers to lend of each card (printing_id null), and of each printing in
-- p_printings, per language ([{language, copies}], languages with none left out): copies
-- marked to lend and not out on a loan, of p_language if given, but never the copies their
-- decks not for lending hold. Those hold copies of a card, not of a printing, so a printing's
-- count is capped by the card's in that language.
create function public.riftbound_free_to_lend(p_user text, p_printings text[] default '{}', p_language text default null)
returns table (card_id text, printing_id text, copies jsonb)
language sql
stable
set search_path = ''
as $$
    with f as (
        select p.card_id, c.printing_id, c.language::text as language,
            greatest(public.riftbound_lendable(c, pr) - coalesce(o.lent, 0), 0) as free
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        left join public.profiles pr on pr.user_id = c.user_id
        left join public.riftbound_lent_out(p_user) o on o.printing_id = c.printing_id and o.finish = c.finish
            and o.condition = c.condition and o.language = c.language::text
        where c.user_id = p_user and (p_language is null or c.language::text = p_language)
    ),
    l as (
        select w.card_id, w.printing_id, f.language,
            least(coalesce(sum(f.free) filter (where w.printing_id is null or f.printing_id = w.printing_id), 0), h.in_hand - h.held) as n
        from (
            select f.card_id, null::text as printing_id from f
            union
            select p.card_id, p.id from public.riftbound_printings p where p.id = any (p_printings)
        ) w
        join f on f.card_id = w.card_id
        join public.riftbound_held_in_hand(p_user) h on h.card_id = f.card_id and h.language = f.language
        group by w.card_id, w.printing_id, f.language, h.in_hand, h.held
    )
    select l.card_id, l.printing_id,
        jsonb_agg(jsonb_build_object('language', l.language, 'copies', l.n) order by l.language collate "C")
    from l
    where l.n > 0
    group by l.card_id, l.printing_id;
$$;

-- As in 20261107000000_riftbound_deck_lending.sql, but what the lender's decks not for
-- lending hold of the card per deck language ([{language, copies}]), for /lend to allocate.
create function public.riftbound_lend_options(p_lender text, p_cards text[], p_fixes bigint)
returns table (card_id text, printing_id text, finish text, condition text, language text,
    quantity integer, lendable integer, lent integer, holds jsonb)
language sql
stable
set search_path = ''
as $$
    select p.card_id, c.printing_id, c.finish, c.condition, c.language::text, c.quantity,
        public.riftbound_lendable(c, pr), (coalesce(o.lent, 0) - coalesce(f.quantity, 0))::integer,
        coalesce(h.holds, '[]')
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    left join public.profiles pr on pr.user_id = c.user_id
    left join public.riftbound_lent_out(p_lender) o on o.printing_id = c.printing_id and o.finish = c.finish
        and o.condition = c.condition and o.language = c.language::text
    left join public.riftbound_loan_cards f on f.loan_id = p_fixes and f.printing_id = c.printing_id
        and f.finish = c.finish and f.condition = c.condition and f.language = c.language
        and exists (select from public.riftbound_loans fl
                    where fl.id = p_fixes and fl.lender_id = p_lender and public.riftbound_loan_state(fl.id) = 'open')
    left join (
        select d.card_id, jsonb_agg(jsonb_build_object('language', d.language, 'copies', d.held)) as holds
        from public.riftbound_deck_held(p_lender) d
        group by d.card_id
    ) h on h.card_id = p.card_id
    where c.user_id = p_lender and p.card_id = any (p_cards);
$$;

revoke execute on function public.riftbound_deck_held(text) from public, anon, authenticated;
revoke execute on function public.riftbound_held_in_hand(text) from public, anon, authenticated;
revoke execute on function public.riftbound_free_to_lend(text, text[], text) from public, anon, authenticated;
revoke execute on function public.riftbound_lend_options(text, text[], bigint) from public, anon, authenticated;
grant execute on function public.riftbound_lend_options(text, text[], bigint) to service_role;

-- As in 20261107000000_riftbound_deck_lending.sql, with copies per language.
create function public.riftbound_card_lenders(p_cards text[], p_printings text[] default '{}', p_language text default null)
returns table (card_id text, printing_id text, guild_id text, guild_name text, user_id text, display_name text,
    avatar_url text, copies jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select l.card_id, l.printing_id, g.guild_id, g.name, m.user_id, m.display_name, m.avatar_url, l.copies
    from public.guild_members b
    join public.guilds g on g.guild_id = b.guild_id
    join public.guild_members a on a.guild_id = b.guild_id and a.user_id <> b.user_id
    join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    join public.profiles pr on pr.user_id = a.user_id and pr.lends_cards and pr.visibility <> 'private'
    join public.riftbound_free_to_lend(a.user_id, p_printings, p_language) l
        on l.printing_id is null and l.card_id = any (p_cards) or l.printing_id = any (p_printings)
    where b.user_id = public.current_discord_id() and public.can_see_profile(a.user_id)
    order by l.card_id, l.printing_id nulls first, g.name,
        (select sum((x ->> 'copies')::bigint) from jsonb_array_elements(l.copies) x) desc, m.display_name;
$$;

revoke execute on function public.riftbound_card_lenders(text[], text[], text) from public;
grant execute on function public.riftbound_card_lenders(text[], text[], text) to authenticated;

create function public.card_lenders(p_card text)
returns table (guild_id text, guild_name text, user_id text, display_name text, avatar_url text, copies jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select l.guild_id, l.guild_name, l.user_id, l.display_name, l.avatar_url, l.copies
    from public.riftbound_card_lenders(array[p_card]) l;
$$;

revoke execute on function public.card_lenders(text) from public;
grant execute on function public.card_lenders(text) to authenticated;

create function public.my_riftbound_lend_options(p_cards text[])
returns table (card_id text, printing_id text, finish text, condition text, language text,
    quantity integer, lendable integer, lent integer, holds jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select * from public.riftbound_lend_options(public.current_discord_id(), p_cards, null);
$$;

revoke execute on function public.my_riftbound_lend_options(text[]) from public, anon;
grant execute on function public.my_riftbound_lend_options(text[]) to authenticated;
