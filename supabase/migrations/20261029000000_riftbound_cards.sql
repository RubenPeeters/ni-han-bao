-- The Riftbound card catalogue (#148), for every Riftbound feature: placeholder cards until
-- Riot approves the API key (#96), then the API's. The bot loads it (bot/riftbound-catalogue.json).
-- Additive only.

-- Global, not per server: no guild_id, and nothing about people.
-- One row per abstract card, whatever it was printed in.
create table if not exists public.riftbound_cards (
    id text primary key,
    name text not null check (length(name) between 1 and 200),
    type text not null,
    supertypes text[] not null default '{}',
    domains text[] not null default '{}',
    energy smallint check (energy >= 0),
    might smallint check (might >= 0),
    -- Legends are named by epithet; their champion is a tag.
    tags text[] not null default '{}',
    rules_text text,
    -- Made up by bot/src/riftbound.ts, not Riot's data: the site labels it "Placeholder card".
    placeholder boolean not null default false,
    updated_at timestamptz not null default now()
);

-- Finish and condition are not here: they belong to the copy someone owns (Riot's feed has
-- no finish concept).
create table if not exists public.riftbound_printings (
    id text primary key,
    card_id text not null references public.riftbound_cards (id) on delete cascade,
    set_code text not null,
    -- Text, as printed: "OGN-007a", "VEN-R04", "SFD-232*".
    collector_code text not null,
    -- Only for sorting.
    collector_number integer not null,
    rarity text,
    illustrator text,
    image_url text,
    updated_at timestamptz not null default now(),
    unique (set_code, collector_code)
);

create index if not exists riftbound_printings_card_id on public.riftbound_printings (card_id);

-- Anyone logged in reads the catalogue; anon nothing. Only the bot writes.
alter table public.riftbound_cards enable row level security;
alter table public.riftbound_printings enable row level security;

create policy "logged in read" on public.riftbound_cards for select to authenticated using (true);
create policy "logged in read" on public.riftbound_printings for select to authenticated using (true);
