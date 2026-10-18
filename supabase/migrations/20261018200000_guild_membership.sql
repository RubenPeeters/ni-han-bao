-- Multi-server, part 2: which servers the bot is in and who is a member of each, so a later
-- part can show logged-in visitors only their own servers. Kept by the bot from the gateway,
-- not from the visitor's OAuth token, so no Discord token is stored. Ids only.
-- Same convention as bot_status: RLS on, anon/authenticated may only SELECT, only the bot writes.

create table if not exists public.guilds (
    guild_id text primary key,
    name text not null,
    icon_url text,
    updated_at timestamptz not null default now()
);

alter table public.guilds enable row level security;

create policy "public read" on public.guilds for select to anon, authenticated using (true);

create table if not exists public.guild_members (
    guild_id text not null,
    user_id text not null,
    primary key (guild_id, user_id)
);

alter table public.guild_members enable row level security;

create policy "public read" on public.guild_members for select to anon, authenticated using (true);

-- The logged-in visitor's Discord user id, or null. Read from auth.identities, not from the
-- JWT's user_metadata: a user can rewrite their own user_metadata (auth.updateUser), so it
-- cannot be trusted for access checks. Confirmed in the supabase/auth source: the Discord
-- provider (internal/api/provider/discord.go) sets the claims' Subject and ProviderId to the
-- Discord user id, and models.NewIdentity (internal/models/identity.go) stores
-- identity_data->>'sub' as auth.identities.provider_id.
-- Security definer because the authenticated role cannot read the auth schema.
create or replace function public.current_discord_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select i.provider_id
    from auth.identities i
    where i.user_id = auth.uid() and i.provider = 'discord'
    limit 1;
$$;

-- Security definer so it keeps working once part 5 restricts who can read guild_members.
create or replace function public.is_guild_member(g text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select from public.guild_members m
        where m.guild_id = g and m.user_id = public.current_discord_id()
    );
$$;

revoke execute on function public.current_discord_id() from public;
revoke execute on function public.is_guild_member(text) from public;
grant execute on function public.current_discord_id() to anon, authenticated, service_role;
grant execute on function public.is_guild_member(text) to anon, authenticated, service_role;
