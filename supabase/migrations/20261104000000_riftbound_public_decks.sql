-- Public deck pages (#175): a 'public' deck is readable logged out too, by its link. Additive
-- only: the deck tables and the catalogue stay closed to anon; this returns one public deck,
-- without its owner, and only the cards and printings it uses.
create or replace function public.public_deck(p_deck uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with deck as (
        select d.id, d.name, d.legend_id, d.champion_id, d.notes, d.visibility, d.language, d.allow_other_languages
        from public.riftbound_decks d
        where d.id = p_deck and d.visibility = 'public'
    ), entries as (
        select e.section, e.card_id, e.printing_id, e.quantity
        from public.riftbound_deck_cards e
        where e.deck_id = (select id from deck)
    ), used as (
        select card_id as id from entries
        union select legend_id from deck
        union select champion_id from deck
    )
    select jsonb_build_object(
        'deck', to_jsonb(deck),
        'entries', coalesce((select jsonb_agg(to_jsonb(e)) from entries e), '[]'),
        'cards', coalesce((select jsonb_agg(to_jsonb(c)) from public.riftbound_cards c where c.id in (select id from used)), '[]'),
        'printings', coalesce((select jsonb_agg(to_jsonb(p)) from public.riftbound_printings p where p.card_id in (select id from used)), '[]')
    )
    from deck;
$$;

revoke execute on function public.public_deck(uuid) from public;
grant execute on function public.public_deck(uuid) to anon, authenticated;
