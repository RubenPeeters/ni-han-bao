-- Game and streaming time from Discord presence (#101): only the activity's name and how
-- long it ran, never anything else from the presence. Additive only.

-- Not per server: a user is counted once across every server they share with the bot, so
-- no guild_id, like profiles. Server pages join guild_members. Days are UTC.
create table if not exists public.activity_seconds (
    user_id text not null,
    day date not null,
    kind text not null check (kind in ('playing', 'streaming', 'competing')),
    name text not null check (length(name) between 1 and 128),
    seconds integer not null check (seconds between 0 and 86400),
    -- When the bot last saw the session still open; null once it closed. Drives "playing now".
    live_at timestamptz,
    primary key (user_id, day, kind, name)
);

create index if not exists activity_seconds_live_at on public.activity_seconds (live_at);

-- RLS on and no policies: read only through the security definer functions below.
alter table public.activity_seconds enable row level security;

create trigger skip_forgotten before insert on public.activity_seconds
    for each row execute function public.skip_forgotten();

-- Hidden in any server means hidden everywhere for a cross-server row, as in can_see_profile().
create index if not exists members_hidden on public.members (user_id) where hidden;

-- One batch of game time, applied at most once per id like increment_timeline(). Members
-- hidden with /hide-me are dropped here, so the bot needs no copy of who is hidden.
create or replace function public.increment_games(batch uuid, games jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    delete from public.applied_count_batches where applied_at < now() - interval '7 days';

    insert into public.applied_count_batches (batch_id) values (batch) on conflict do nothing;
    if not found then
        return;  -- already applied by an earlier attempt
    end if;

    insert into public.activity_seconds (user_id, day, kind, name, seconds, live_at)
    select g.user_id, g.day, g.kind, g.name, least(g.seconds, 86400), case when g.live then now() end
    from jsonb_to_recordset(games) as g(user_id text, day date, kind text, name text, seconds integer, live boolean)
    where not exists (select from public.members m where m.user_id = g.user_id and m.hidden)
    on conflict (user_id, day, kind, name)
    do update set
        seconds = least(public.activity_seconds.seconds + excluded.seconds, 86400),
        live_at = excluded.live_at;
end;
$$;

revoke execute on function public.increment_games(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.increment_games(uuid, jsonb) to service_role;

-- The profile's last 30 days: one row per game (playing and competing together) and one
-- with a null name for all streaming. Like profile_badges(), only for visitors who share a
-- server with `u` (or `u` themselves), also for a 'public' profile.
create or replace function public.profile_games(u text)
returns table (name text, seconds bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select case when a.kind = 'streaming' then null else a.name end, sum(a.seconds)::bigint
    from public.activity_seconds a
    where a.user_id = u and a.day >= current_date - 29
        and public.can_see_profile(u)
        and (public.current_discord_id() = u or exists (
            select from public.guild_members x
            join public.guild_members y on y.guild_id = x.guild_id and y.user_id = public.current_discord_id()
            where x.user_id = u
        ))
    group by 1
    order by 2 desc, 1;
$$;

revoke execute on function public.profile_games(text) from public;
grant execute on function public.profile_games(text) to anon, authenticated;

-- The server's top games since `since`, over its current members. Totals only, no names, so
-- private profiles count too; hidden members do not.
create or replace function public.guild_games(g text, since date, top integer default 10)
returns table (name text, seconds bigint, players bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select a.name, sum(a.seconds)::bigint, count(distinct a.user_id)
    from public.activity_seconds a
    join public.guild_members gm on gm.guild_id = g and gm.user_id = a.user_id
    where public.is_guild_member(g) and a.kind <> 'streaming' and a.day >= since
        and not exists (select from public.members m where m.user_id = a.user_id and m.hidden)
    group by a.name
    order by 2 desc, 1
    limit top;
$$;

revoke execute on function public.guild_games(text, date, integer) from public;
grant execute on function public.guild_games(text, date, integer) to authenticated;

-- Who in the server is playing or streaming right now: sessions the bot saw open in the last
-- two minutes (it reports them every flush). Only members whose profile is not private are
-- named; the others are counted in `others`.
create or replace function public.guild_playing_now(g text)
returns table (kind text, name text, players text[], others bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select a.kind, a.name,
        coalesce(array_agg(m.display_name order by m.display_name) filter (where n.named), '{}'),
        count(*) filter (where not n.named)
    from (
        select distinct s.user_id, s.kind, s.name from public.activity_seconds s
        where s.live_at > now() - interval '2 minutes'
    ) a
    join public.guild_members gm on gm.guild_id = g and gm.user_id = a.user_id
    left join public.members m on m.guild_id = g and m.user_id = a.user_id
    cross join lateral (
        select m.display_name is not null
            and coalesce((select p.visibility from public.profiles p where p.user_id = a.user_id), 'private') <> 'private'
            as named
    ) n
    where public.is_guild_member(g)
        and not exists (select from public.members h where h.user_id = a.user_id and h.hidden)
    group by a.kind, a.name
    order by count(*) desc, a.name;
$$;

revoke execute on function public.guild_playing_now(text) from public;
grant execute on function public.guild_playing_now(text) to authenticated;
