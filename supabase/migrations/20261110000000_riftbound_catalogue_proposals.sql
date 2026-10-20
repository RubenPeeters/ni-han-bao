-- Riot's card feed, checked daily (#204): each content that differed from the catalogue, and
-- what the bot's owner decided. Accepted rows are upserted; rejected content is not proposed again.
-- Additive only.

-- Global, not per server: no guild_id, and nothing about people.
create table if not exists public.riftbound_catalogue_proposals (
    id bigint generated always as identity primary key,
    build_id text not null,
    -- sha256 of the transformed cards (the manifest's), whatever the build id.
    checksum text not null unique,
    added integer not null check (added >= 0),
    changed integer not null check (changed >= 0),
    gone integer not null check (gone >= 0),
    status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
    proposed_at timestamptz not null default now(),
    decided_at timestamptz
);

-- Like the catalogue: anyone logged in reads it, anon nothing. Only the bot writes.
alter table public.riftbound_catalogue_proposals enable row level security;

create policy "logged in read" on public.riftbound_catalogue_proposals for select to authenticated using (true);
