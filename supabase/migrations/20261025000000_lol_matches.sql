-- League games (#104): each linked account's ranked and normal games of the last 10 days,
-- fetched from Match-V5 by the bot every 6 hours, for the weekly report and the Ranked page.
-- Additive only.

-- Not per server (an account spans them), so no guild_id. Only the ranked and normal queues
-- are fetched, never custom games (Riot policy: customs are private unless opted in).
-- Deleted with its account on /lol unlink.
create table if not exists public.lol_matches (
    user_id text not null,
    game text not null default 'lol' check (game = 'lol'),
    -- The account the game was played on: rows of an account linked before stay unread.
    puuid text not null,
    match_id text not null,
    queue_id integer not null,
    -- Riot's championName, as Match-V5 sends it.
    champion text not null,
    played_at timestamptz not null,
    primary key (user_id, match_id),
    foreign key (user_id, game) references public.game_accounts (user_id, game) on delete cascade
);

-- RLS on and no policies: read through the functions below only.
alter table public.lol_matches enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.lol_matches
    for each row execute function public.skip_forgotten();

-- The server's linked members (hidden ones left out) with their games in [since, until) and
-- their most played champion. For the bot's weekly report; the site reads guild_lol_week().
create or replace function public.lol_week(g text, since timestamptz, until timestamptz)
returns table (user_id text, display_name text, avatar_url text, games bigint, champion text)
language sql
stable
security invoker
set search_path = ''
as $$
    select a.user_id, m.display_name, m.avatar_url,
        (select count(*) from public.lol_matches x
         where x.user_id = a.user_id and x.puuid = a.external_id and x.played_at >= since and x.played_at < until),
        (select x.champion from public.lol_matches x
         where x.user_id = a.user_id and x.puuid = a.external_id and x.played_at >= since and x.played_at < until
         group by x.champion order by count(*) desc, x.champion limit 1)
    from public.game_accounts a
    join public.guild_members gm on gm.guild_id = g and gm.user_id = a.user_id
    join public.members m on m.guild_id = g and m.user_id = a.user_id
    where a.game = 'lol' and not m.hidden
    order by 4 desc, m.display_name;
$$;

revoke execute on function public.lol_week(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.lol_week(text, timestamptz, timestamptz) to service_role;

-- The Ranked page: the same for the last 7 days. Members only.
create or replace function public.guild_lol_week(g text)
returns table (user_id text, display_name text, avatar_url text, games bigint, champion text)
language sql
stable
security definer
set search_path = ''
as $$
    select * from public.lol_week(g, now() - interval '7 days', now())
    where public.is_guild_member(g);
$$;

revoke execute on function public.guild_lol_week(text) from public;
grant execute on function public.guild_lol_week(text) to authenticated;
