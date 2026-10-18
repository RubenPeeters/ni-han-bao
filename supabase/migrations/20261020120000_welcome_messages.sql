-- Servers the bot has posted its welcome message in (#68), so it goes out once per server.
-- Kept when the bot leaves (unlike guilds), so a re-invite does not welcome again.
-- Additive only: the previous release keeps working against it.

create table if not exists public.welcome_messages (
    guild_id text primary key,
    channel_id text not null,
    created_at timestamptz not null default now()
);

alter table public.welcome_messages enable row level security;

create policy "members read" on public.welcome_messages for select to authenticated
    using (public.is_guild_member(guild_id));
