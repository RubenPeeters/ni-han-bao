-- The bot's application emojis of Riot's Riftbound icons (#224): which icon URL each one was
-- made from, so a changed icon is replaced and an unchanged one is left alone across restarts.
-- Discord keeps no source URL with an emoji. Additive only.

-- Global, not per server: no guild_id, and nothing about people. Nothing to read on the site.
create table if not exists public.riftbound_emojis (
    -- The emoji's name on Discord ("rb_fury").
    name text primary key,
    emoji_id text not null,
    source_url text not null,
    updated_at timestamptz not null default now()
);

alter table public.riftbound_emojis enable row level security;
