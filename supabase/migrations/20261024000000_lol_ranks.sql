-- League ranks (#103): Riot's own tier, division and LP per ranked queue for each linked
-- account, refreshed by the bot every 3 hours; and /setup rank-roles. Additive only.

-- Not per server (an account spans them), so no guild_id. Riot policy: only Riot's official
-- rank, never a computed score. Deleted with its account on /lol unlink.
create table if not exists public.lol_ranks (
    user_id text not null,
    game text not null default 'lol' check (game = 'lol'),
    -- RANKED_SOLO_5x5 or RANKED_FLEX_SR.
    queue text not null,
    tier text not null,
    -- Null for Master, Grandmaster and Challenger, which have no divisions.
    division text,
    lp integer not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, queue),
    foreign key (user_id, game) references public.game_accounts (user_id, game) on delete cascade
);

-- RLS on and no policies: the site reads it through the functions below only.
alter table public.lol_ranks enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.lol_ranks
    for each row execute function public.skip_forgotten();

-- Riot's order, lowest first; only for sorting, never shown as a number.
create or replace function public.lol_tier_order(tier text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select array_position(
        array['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'],
        tier
    );
$$;

-- The profile's ranks, for whoever may see the profile (can_see_profile()).
create or replace function public.profile_ranks(u text)
returns table (queue text, tier text, division text, lp integer)
language sql
stable
security definer
set search_path = ''
as $$
    select r.queue, r.tier, r.division, r.lp from public.lol_ranks r
    where r.user_id = u and public.can_see_profile(u)
    order by r.queue desc;
$$;

revoke execute on function public.profile_ranks(text) from public;
grant execute on function public.profile_ranks(text) to anon, authenticated;

-- The server's Ranked page: its linked members in one queue, by official rank. Members only;
-- hidden members (/hide-me) stay out.
create or replace function public.guild_ranks(g text, q text)
returns table (user_id text, display_name text, avatar_url text, tier text, division text, lp integer)
language sql
stable
security definer
set search_path = ''
as $$
    select r.user_id, m.display_name, m.avatar_url, r.tier, r.division, r.lp
    from public.lol_ranks r
    join public.guild_members gm on gm.guild_id = g and gm.user_id = r.user_id
    join public.members m on m.guild_id = g and m.user_id = r.user_id
    where public.is_guild_member(g) and r.queue = q and not m.hidden
    order by public.lol_tier_order(r.tier) desc,
        array_position(array['IV', 'III', 'II', 'I'], r.division) desc nulls first,
        r.lp desc, m.display_name;
$$;

revoke execute on function public.guild_ranks(text, text) from public;
grant execute on function public.guild_ranks(text, text) to authenticated;

-- /setup rank-roles: whether the bot keeps a role per tier in sync in this server.
alter table public.guild_settings add column if not exists rank_roles boolean not null default false;
