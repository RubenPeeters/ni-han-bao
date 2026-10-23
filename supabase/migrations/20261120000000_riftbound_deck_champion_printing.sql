-- The Chosen Champion's printing (#268), as the Legend's (#249): the header shows it, and one main
-- deck copy of the champion is pinned to it, so matching asks for it as for any pinned entry.
-- Additive: save_riftbound_deck() gains a trailing parameter with a default, so its callers keep
-- working; null is any printing, as before.

alter table public.riftbound_decks add column if not exists champion_printing_id text;
alter table public.riftbound_decks add constraint riftbound_decks_champion_printing
    foreign key (champion_printing_id, champion_id) references public.riftbound_printings (id, card_id);
-- No foreign key, as the version's legend_printing_id: a version outlives the catalogue.
alter table public.riftbound_deck_versions add column if not exists champion_printing_id text;

-- As in 20261116000000_riftbound_deck_legend_printing.sql, plus the champion's printing.
create or replace function public.snapshot_riftbound_deck(p_deck uuid)
returns void
language sql
volatile
set search_path = ''
as $$
    insert into public.riftbound_deck_versions
        (deck_id, version, saved_at, name, legend_id, legend_printing_id, champion_id, champion_printing_id, notes, language,
            allow_other_languages, entries)
    select d.id, coalesce((select max(v.version) from public.riftbound_deck_versions v where v.deck_id = d.id), 0) + 1,
        d.updated_at, d.name, d.legend_id, d.legend_printing_id, d.champion_id, d.champion_printing_id, d.notes, d.language,
        d.allow_other_languages,
        coalesce((
            select jsonb_agg(jsonb_build_object('section', c.section, 'card_id', c.card_id, 'printing_id', c.printing_id,
                'quantity', c.quantity) order by c.section, c.card_id, c.printing_id)
            from public.riftbound_deck_cards c where c.deck_id = d.id
        ), '[]')
    from public.riftbound_decks d where d.id = p_deck;
$$;

-- As in 20261116000000_riftbound_deck_legend_printing.sql, plus p_champion_printing.
drop function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text, text);
create function public.save_riftbound_deck(
    p_deck uuid, p_name text, p_legend text, p_champion text, p_notes text, p_visibility text,
    p_language text, p_allow_other_languages boolean, p_entries jsonb, p_wishlist_mode text default null,
    p_legend_printing text default null, p_champion_printing text default null
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
        insert into public.riftbound_decks (user_id, name, legend_id, legend_printing_id, champion_id, champion_printing_id, notes,
            visibility, language, allow_other_languages, wishlist_mode)
        values (me, p_name, p_legend, p_legend_printing, p_champion, p_champion_printing, coalesce(p_notes, ''),
            coalesce(p_visibility, 'private'), coalesce(p_language, 'en'), coalesce(p_allow_other_languages, true),
            coalesce(p_wishlist_mode, (select p.wishlist_mode from public.profiles p where p.user_id = me), 'none'))
        returning id into deck;
        -- skip_forgotten() drops the row silently; say so instead of reporting a save.
        if deck is null then
            raise exception 'you asked to be forgotten: use /show-me in Discord first';
        end if;
    else
        update public.riftbound_decks set name = p_name, legend_id = p_legend, legend_printing_id = p_legend_printing,
            champion_id = p_champion, champion_printing_id = p_champion_printing, notes = coalesce(p_notes, ''),
            visibility = p_visibility, language = p_language, allow_other_languages = p_allow_other_languages,
            wishlist_mode = coalesce(p_wishlist_mode, wishlist_mode), updated_at = now()
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

revoke execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text, text, text) from public, anon;
grant execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text, text, text) to authenticated;
