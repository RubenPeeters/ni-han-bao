-- Riot's real cards replace the placeholders (#206): the placeholder cards (placeholder = true)
-- are deleted, with every row that points at one. Ruben's decision; the release note says so.
-- Runs on dev and production. Rows only: the placeholder column stays (no drops in the same
-- release), and the real cards come through the bot's Accept (#204), not from here.
--
-- Every foreign key to the catalogue, and what happens to its rows:
--   riftbound_printings.card_id -> riftbound_cards: cascades with the card.
--   riftbound_collection.printing_id -> riftbound_printings: deleted below.
--   riftbound_loan_cards.printing_id -> riftbound_printings: the whole loan is deleted below;
--     its riftbound_loan_cards and riftbound_loan_entries cascade (riftbound_loans.replaces and
--     riftbound_loan_entries.replaces set null, as when forget_user() erases a loan).
--   riftbound_decks.legend_id, riftbound_decks.champion_id -> riftbound_cards: the deck is deleted
--     below; its riftbound_deck_cards, riftbound_deck_versions and riftbound_deck_opens cascade.
--   riftbound_deck_cards.card_id -> riftbound_cards, (printing_id, card_id) -> riftbound_printings:
--     deleted below from the decks that stay.
--   riftbound_wishlist.card_id -> riftbound_cards, (printing_id, card_id) -> riftbound_printings:
--     deleted below.
--   riftbound_trade_matches.card_id -> riftbound_cards: deleted below.
-- Not a foreign key, but a reference: riftbound_deck_versions of the decks that stay that name a
-- placeholder (legend, champion or an entry) are deleted too, as restoring one would fail.

-- One statement, so the ledger's exception holds for exactly these deletes, in one transaction.
do $$
begin
    -- The lending ledger is append-only (#172); erasing is its one exception.
    perform set_config('ni_han_bao.erase_loans', 'on', true);
    delete from public.riftbound_loans l
    where exists (
        select from public.riftbound_loan_cards lc
        join public.riftbound_printings p on p.id = lc.printing_id
        join public.riftbound_cards c on c.id = p.card_id
        where lc.loan_id = l.id and c.placeholder
    );
    perform set_config('ni_han_bao.erase_loans', 'off', true);

    delete from public.riftbound_collection rc
    using public.riftbound_printings p, public.riftbound_cards c
    where p.id = rc.printing_id and c.id = p.card_id and c.placeholder;

    delete from public.riftbound_decks d
    where exists (select from public.riftbound_cards c where c.id in (d.legend_id, d.champion_id) and c.placeholder);
    delete from public.riftbound_deck_cards dc
    using public.riftbound_cards c
    where c.id = dc.card_id and c.placeholder;
    delete from public.riftbound_deck_versions v
    where exists (
        select from public.riftbound_cards c
        where c.placeholder and (
            c.id in (v.legend_id, v.champion_id)
            or exists (select from jsonb_array_elements(v.entries) e where e ->> 'card_id' = c.id)
        )
    );

    delete from public.riftbound_wishlist w
    using public.riftbound_cards c
    where c.id = w.card_id and c.placeholder;
    delete from public.riftbound_trade_matches t
    using public.riftbound_cards c
    where c.id = t.card_id and c.placeholder;

    -- Their printings cascade.
    delete from public.riftbound_cards where placeholder;
end;
$$;
