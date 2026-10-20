-- Public deck pages (#175): a 'public' deck is read logged in only, so logged out its page shows a
-- teaser: the Legend and the Chosen Champion, nothing of the owner, the name or the list. Additive
-- only: the deck tables and the catalogue stay closed to anon.
create or replace function public.public_deck_teaser(p_deck uuid)
returns table (legend_name text, legend_tags text[], champion_name text)
language sql
stable
security definer
set search_path = ''
as $$
    select l.name, l.tags, c.name
    from public.riftbound_decks d
    left join public.riftbound_cards l on l.id = d.legend_id
    left join public.riftbound_cards c on c.id = d.champion_id
    where d.id = p_deck and d.visibility = 'public';
$$;

revoke execute on function public.public_deck_teaser(uuid) from public;
grant execute on function public.public_deck_teaser(uuid) to anon, authenticated;
