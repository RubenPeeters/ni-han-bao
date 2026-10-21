-- Riot's official Riftbound icons (#218), from the card feed: one row per faceted value (card
-- type, supertype, rarity, domain) and per glyph (might, power, artist). The URL points at
-- Riot's CDN; the icon is never rehosted. Written with the cards by the bot's Accept (#204).
-- Additive only.

-- Global, not per server: no guild_id, and nothing about people.
create table if not exists public.riftbound_icons (
    -- 'type', 'supertype', 'rarity', 'domain' or 'glyph'.
    facet text not null,
    -- The feed's id ("fury"); for a glyph, the feed field that shows it ("might").
    value text not null,
    label text not null,
    icon_url text not null check (icon_url ~ '^https://(cmsassets|assetcdn)\.rgpub\.io/'),
    color_primary text check (color_primary ~ '^#[0-9A-Fa-f]{6}$'),
    color_secondary text check (color_secondary ~ '^#[0-9A-Fa-f]{6}$'),
    updated_at timestamptz not null default now(),
    primary key (facet, value)
);

-- Like the catalogue: anyone logged in reads it, anon nothing. Only the bot writes.
alter table public.riftbound_icons enable row level security;

create policy "logged in read" on public.riftbound_icons for select to authenticated using (true);
