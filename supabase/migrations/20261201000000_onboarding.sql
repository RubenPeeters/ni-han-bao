-- Onboarding (#307): a DM to each member who joins, with the roles the server's admins offer
-- (/setup onboarding), and /roles for the same picker later. Additive only.

-- Off by default: nothing is sent until an admin turns it on.
alter table public.guild_settings add column if not exists onboarding boolean not null default false;

-- The roles offered, at most 25 (one Discord select menu; the bot checks it before writing).
-- Kept when the bot leaves, like guild_settings, so a re-invite keeps its setup.
create table if not exists public.onboarding_roles (
    guild_id text not null,
    role_id text not null,
    -- Shown in the picker; the role's name when the admin gave none.
    label text not null,
    created_at timestamptz not null default now(),
    primary key (guild_id, role_id)
);

alter table public.onboarding_roles enable row level security;

create policy "members read" on public.onboarding_roles for select to authenticated
    using (public.is_guild_member(guild_id));

-- One row per member per server, claimed before the DM is sent: a rejoin or a restart does
-- not DM again, and DMs closed is recorded, never retried. Kept when the member leaves.
create table if not exists public.onboarding_dms (
    guild_id text not null,
    user_id text not null,
    state text not null default 'sent' check (state in ('sent', 'dms_closed', 'answered', 'declined')),
    sent_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (guild_id, user_id)
);

alter table public.onboarding_dms enable row level security;

-- Opt-out: a member hidden in this server is not shown.
create policy "members read" on public.onboarding_dms for select to authenticated using (
    public.is_guild_member(guild_id) and not public.is_hidden_member(guild_id, user_id)
);

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out, and
-- so keeps the bot from DMing them: the claim comes back empty.
create trigger skip_forgotten before insert on public.onboarding_dms
    for each row execute function public.skip_forgotten();
