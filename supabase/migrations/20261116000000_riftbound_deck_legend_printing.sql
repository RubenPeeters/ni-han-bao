-- The Legend's printing (#249): a deck may pin its Legend to one printing, as its entries can.
-- Additive: save_riftbound_deck() and add_riftbound_deck_card() gain a parameter with a default,
-- so their callers keep working; null is any printing, as before.

-- Of the deck's own Legend only, as riftbound_deck_cards' pins (riftbound_printings_id_card).
alter table public.riftbound_decks add column if not exists legend_printing_id text;
alter table public.riftbound_decks add constraint riftbound_decks_legend_printing
    foreign key (legend_printing_id, legend_id) references public.riftbound_printings (id, card_id);
-- No foreign key, as the version's legend_id and entries: a version outlives the catalogue.
alter table public.riftbound_deck_versions add column if not exists legend_printing_id text;

-- As in 20261104000000_riftbound_deck_versions.sql, plus the Legend's printing.
create or replace function public.snapshot_riftbound_deck(p_deck uuid)
returns void
language sql
volatile
set search_path = ''
as $$
    insert into public.riftbound_deck_versions
        (deck_id, version, saved_at, name, legend_id, legend_printing_id, champion_id, notes, language, allow_other_languages, entries)
    select d.id, coalesce((select max(v.version) from public.riftbound_deck_versions v where v.deck_id = d.id), 0) + 1,
        d.updated_at, d.name, d.legend_id, d.legend_printing_id, d.champion_id, d.notes, d.language, d.allow_other_languages,
        coalesce((
            select jsonb_agg(jsonb_build_object('section', c.section, 'card_id', c.card_id, 'printing_id', c.printing_id,
                'quantity', c.quantity) order by c.section, c.card_id, c.printing_id)
            from public.riftbound_deck_cards c where c.deck_id = d.id
        ), '[]')
    from public.riftbound_decks d where d.id = p_deck;
$$;

-- As in 20261105000000_riftbound_wishlist.sql, plus p_legend_printing.
drop function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text);
create function public.save_riftbound_deck(
    p_deck uuid, p_name text, p_legend text, p_champion text, p_notes text, p_visibility text,
    p_language text, p_allow_other_languages boolean, p_entries jsonb, p_wishlist_mode text default null,
    p_legend_printing text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); deck uuid;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    if p_deck is null then
        insert into public.riftbound_decks (user_id, name, legend_id, legend_printing_id, champion_id, notes, visibility,
            language, allow_other_languages, wishlist_mode)
        values (me, p_name, p_legend, p_legend_printing, p_champion, coalesce(p_notes, ''), coalesce(p_visibility, 'private'),
            coalesce(p_language, 'en'), coalesce(p_allow_other_languages, true),
            coalesce(p_wishlist_mode, (select p.wishlist_mode from public.profiles p where p.user_id = me), 'none'))
        returning id into deck;
        -- skip_forgotten() drops the row silently; say so instead of reporting a save.
        if deck is null then
            raise exception 'you asked to be forgotten: use /show-me in Discord first';
        end if;
    else
        update public.riftbound_decks set name = p_name, legend_id = p_legend, legend_printing_id = p_legend_printing,
            champion_id = p_champion, notes = coalesce(p_notes, ''), visibility = p_visibility, language = p_language,
            allow_other_languages = p_allow_other_languages, wishlist_mode = coalesce(p_wishlist_mode, wishlist_mode),
            updated_at = now()
        where id = p_deck and user_id = me
        returning id into deck;
        if deck is null then
            raise exception 'not your deck';
        end if;
        delete from public.riftbound_deck_cards where deck_id = deck;
    end if;
    -- The same card twice in a section (two pasted lines) is one entry.
    insert into public.riftbound_deck_cards (deck_id, section, card_id, printing_id, quantity)
    select deck, e.section, e.card_id, e.printing_id, sum(e.quantity)
    from jsonb_to_recordset(coalesce(p_entries, '[]')) e (section text, card_id text, printing_id text, quantity integer)
    where e.quantity > 0
    group by e.section, e.card_id, e.printing_id;
    perform public.snapshot_riftbound_deck(deck);
    return deck;
end;
$$;

revoke execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text, text) from public, anon;
grant execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text, text) to authenticated;

-- As in 20261104000000_riftbound_deck_versions.sql, plus p_printing: the card's printing, the
-- Legend's or the entry's pin. A legend replaces the Legend and its printing, so another Legend
-- starts at any printing.
drop function public.add_riftbound_deck_card(uuid, text);
create function public.add_riftbound_deck_card(p_deck uuid, p_card text, p_printing text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); kind text;
begin
    if not exists (select from public.riftbound_decks d where d.id = p_deck and d.user_id = me) then
        raise exception 'not your deck';
    end if;
    select c.type into kind from public.riftbound_cards c where c.id = p_card;
    if kind is null then
        raise exception 'no such card';
    end if;
    if kind = 'Legend' then
        update public.riftbound_decks set legend_id = p_card, legend_printing_id = p_printing, updated_at = now() where id = p_deck;
    else
        insert into public.riftbound_deck_cards (deck_id, section, card_id, printing_id, quantity)
        values (p_deck, case kind when 'Rune' then 'runes' when 'Battlefield' then 'battlefields' else 'main' end, p_card, p_printing, 1)
        on conflict (deck_id, section, card_id, printing_id)
            do update set quantity = least(public.riftbound_deck_cards.quantity + 1, 99);
        update public.riftbound_decks set updated_at = now() where id = p_deck;
    end if;
    perform public.snapshot_riftbound_deck(p_deck);
end;
$$;

revoke execute on function public.add_riftbound_deck_card(uuid, text, text) from public, anon;
grant execute on function public.add_riftbound_deck_card(uuid, text, text) to authenticated;

-- As in 20261106000000_riftbound_trades.sql, but the deck's Legend wanted in its printing, as a
-- pinned entry is.
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
            select d.legend_id, d.legend_printing_id, 1 where d.legend_id is not null
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
