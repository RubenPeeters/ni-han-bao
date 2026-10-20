-- Riot's card data (#203), from the feed behind their card gallery. Additive only.

-- Riot leaves the type empty on some cards (tokens such as Buff, some Radiance cards).
alter table public.riftbound_cards alter column type drop not null;

-- Each printing's official English text exactly as the feed gives it (HTML, icon tokens such as
-- ":rb_energy_1:"): reprints differ (errata, templating). The card's rules_text is its newest
-- printing's. effect_text is what a gear gives the unit it is attached to.
alter table public.riftbound_printings add column if not exists rules_text text;
alter table public.riftbound_printings add column if not exists effect_text text;
