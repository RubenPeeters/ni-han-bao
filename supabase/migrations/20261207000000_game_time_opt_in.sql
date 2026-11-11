-- Game time is opt-in (#354): counted only for members who switch it on, with /profile games
-- or on Settings. Off by default, for existing members too.

alter table public.profiles add column if not exists count_games boolean not null default false;

-- Nobody has switched it on yet, so all stored game time goes. The games table (names and
-- icons, nothing about people) stays.
delete from public.activity_seconds;

-- Switching it off deletes the member's game time, from the bot's /profile games or the site's
-- set_count_games() alike. An insert needs nothing: a new row is off and had nothing counted.
create function public.delete_game_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    delete from public.activity_seconds where user_id = new.user_id;
    return null;
end;
$$;

revoke execute on function public.delete_game_time() from public, anon, authenticated;

create trigger delete_game_time after update of count_games on public.profiles
    for each row when (not new.count_games) execute function public.delete_game_time();

-- The Settings page's switch: the visitor's own row only.
create function public.set_count_games(p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id();
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    insert into public.profiles (user_id, count_games) values (me, coalesce(p_on, false))
    on conflict (user_id) do update set count_games = excluded.count_games, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_count_games(boolean) from public, anon;
grant execute on function public.set_count_games(boolean) to authenticated;

-- As in 20261022120000_game_time.sql, and only for members who switched it on: the bot skips
-- the others, this drops what it sent before it learnt of a switch on the site.
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
        and exists (select from public.profiles p where p.user_id = g.user_id and p.count_games)
    on conflict (user_id, day, kind, name)
    do update set
        seconds = least(public.activity_seconds.seconds + excluded.seconds, 86400),
        live_at = excluded.live_at;
end;
$$;

-- The read functions below follow the setting too, as in 20261022120000_game_time.sql and
-- 20261028000000_game_icons.sql otherwise.
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
        and exists (select from public.profiles p where p.user_id = u and p.count_games)
        and public.can_see_profile(u)
        and (public.current_discord_id() = u or exists (
            select from public.guild_members x
            join public.guild_members y on y.guild_id = x.guild_id and y.user_id = public.current_discord_id()
            where x.user_id = u
        ))
    group by 1
    order by 2 desc, 1;
$$;

create or replace function public.guild_games(g text, since date, top integer default 10)
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
        join public.profiles p on p.user_id = a.user_id and p.count_games
        where public.is_guild_member(g) and a.kind <> 'streaming' and a.day >= since
            and not exists (select from public.members m where m.user_id = a.user_id and m.hidden)
        group by a.name
        order by 2 desc, 1
        limit top
    ) t
    left join public.games x on x.name = t.name
    order by t.seconds desc, t.name;
$$;

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
    join public.profiles p on p.user_id = a.user_id and p.count_games
    left join public.members m on m.guild_id = g and m.user_id = a.user_id
    cross join lateral (
        select m.display_name is not null and p.visibility <> 'private' as named
    ) n
    where public.is_guild_member(g)
        and not exists (select from public.members h where h.user_id = a.user_id and h.hidden)
    group by a.kind, a.name
    order by count(*) desc, a.name;
$$;
