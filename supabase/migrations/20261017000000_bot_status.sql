-- Heartbeat written by the bot, read by the public website.
-- Convention for every table in this project: RLS on, the website (anon role, via the
-- publishable key) may only SELECT, and only the bot (secret key, bypasses RLS) writes.
create table if not exists public.bot_status (
    id smallint primary key default 1 check (id = 1),  -- single row
    guild_id text not null,
    guild_name text not null,
    member_count integer not null,
    last_seen timestamptz not null default now()
);

alter table public.bot_status enable row level security;

create policy "public read" on public.bot_status for select to anon, authenticated using (true);
