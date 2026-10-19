-- Game icons on "What we play" (#141): the Discord application behind a game name and its
-- icon hash, so the site can build the CDN URL without asking Discord per page view.

-- Not per server and nothing about people: a game name maps to one application everywhere.
-- Only names the bot saw with an application id get a row; the site falls back to the initial.
create table if not exists public.games (
    name text primary key check (length(name) between 1 and 128),
    application_id text not null,
    -- Null when Discord gave no icon, or the lookup failed.
    icon text,
    updated_at timestamptz not null default now()
);

-- RLS on and no policies: read only through guild_games() below.
alter table public.games enable row level security;

-- New columns change the return type, so the function is replaced, not altered.
drop function if exists public.guild_games(text, date, integer);

-- As in 20261022120000_game_time.sql, plus the game's application id and icon hash.
create function public.guild_games(g text, since date, top integer default 10)
returns table (name text, seconds bigint, players bigint, application_id text, icon text)
language sql
stable
security definer
set search_path = ''
as $$
    select t.name, t.seconds, t.players, x.application_id, x.icon
    from (
        select a.name, sum(a.seconds)::bigint as seconds, count(distinct a.user_id) as players
        from public.activity_seconds a
        join public.guild_members gm on gm.guild_id = g and gm.user_id = a.user_id
        where public.is_guild_member(g) and a.kind <> 'streaming' and a.day >= since
            and not exists (select from public.members m where m.user_id = a.user_id and m.hidden)
        group by a.name
        order by 2 desc, 1
        limit top
    ) t
    left join public.games x on x.name = t.name
    order by t.seconds desc, t.name;
$$;

revoke execute on function public.guild_games(text, date, integer) from public;
grant execute on function public.guild_games(text, date, integer) to authenticated;
