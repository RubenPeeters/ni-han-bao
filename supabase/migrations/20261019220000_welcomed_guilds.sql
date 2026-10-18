-- Servers the bot has posted its welcome message in. Kept apart from guilds, whose row is
-- deleted when the bot leaves, so a re-invite does not welcome the server again.
-- Same convention as the other per-server tables: RLS on, members may only SELECT, only the
-- bot writes.

create table if not exists public.welcomed_guilds (
    guild_id text primary key,
    welcomed_at timestamptz not null default now()
);

alter table public.welcomed_guilds enable row level security;

create policy "members read" on public.welcomed_guilds for select to authenticated
    using (public.is_guild_member(guild_id));
