-- Profile pages (#100): one page per Discord user at /u/[userId], across servers. Who may
-- see it is the user's own choice, checked here rather than in the page. Additive only.

-- Not per server (a profile spans them), so no guild_id. No row means private.
create table if not exists public.profiles (
    user_id text primary key,
    visibility text not null default 'private' check (visibility in ('private', 'members', 'public')),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.profiles
    for each row execute function public.skip_forgotten();

-- Whether the visitor may see `u`'s profile: always their own; for others, never while `u`
-- is hidden (/hide-me) in any server, else per `u`'s visibility. 'public' still needs a
-- login: logged-out pages show nothing per person. Security definer to see hidden rows.
create or replace function public.can_see_profile(u text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(public.current_discord_id() = u, false) or (
        not exists (select from public.members m where m.user_id = u and m.hidden)
        and case coalesce((select p.visibility from public.profiles p where p.user_id = u), 'private')
            when 'public' then public.current_discord_id() is not null
            when 'members' then exists (
                select from public.guild_members a
                join public.guild_members b on b.guild_id = a.guild_id
                where a.user_id = u and b.user_id = public.current_discord_id()
            )
            else false
        end
    );
$$;

revoke execute on function public.can_see_profile(text) from public;
grant execute on function public.can_see_profile(text) to anon, authenticated;

create policy "visible profiles" on public.profiles for select to authenticated
    using (public.can_see_profile(user_id));

-- The header: name and avatar from the user's most recently updated member row. Security
-- definer so a 'public' profile has a name for visitors who share no server with `u`. Own
-- profile: always a row (the name may be null), with the visibility to edit.
create or replace function public.profile(u text)
returns table (display_name text, avatar_url text, visibility text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select latest.display_name, latest.avatar_url,
        case when me.mine then coalesce((select p.visibility from public.profiles p where p.user_id = u), 'private') end,
        me.mine
    from (select coalesce(public.current_discord_id() = u, false) as mine) me
    left join lateral (
        select m.display_name, m.avatar_url from public.members m
        where m.user_id = u
        order by m.updated_at desc
        limit 1
    ) latest on true
    where public.can_see_profile(u) and (me.mine or latest.display_name is not null);
$$;

revoke execute on function public.profile(text) from public;
grant execute on function public.profile(text) to anon, authenticated;

-- One row per server both the visitor and `u` are in. Security invoker: RLS limits it to the
-- visitor's servers and leaves hidden members out of the counts and the rank.
create or replace function public.profile_servers(u text)
returns table (guild_id text, name text, icon_url text, message_count bigint, voice_seconds bigint, rank bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select g.guild_id, g.name, g.icon_url, s.message_count, s.voice_seconds,
        case when s.message_count > 0 then (
            select count(*) + 1 from (
                select from public.message_counts c
                where c.guild_id = g.guild_id
                group by c.user_id
                having sum(c.count) > s.message_count
            ) ahead
        ) end
    from public.guild_members a
    join public.guild_members b on b.guild_id = a.guild_id and b.user_id = public.current_discord_id()
    join public.guilds g on g.guild_id = a.guild_id
    cross join lateral (
        select
            coalesce((select sum(c.count) from public.message_counts c
                where c.guild_id = g.guild_id and c.user_id = u), 0)::bigint as message_count,
            coalesce((select sum(v.seconds) from public.voice_seconds v
                where v.guild_id = g.guild_id and v.user_id = u), 0)::bigint as voice_seconds
    ) s
    where a.user_id = u and public.can_see_profile(u)
    order by s.message_count desc, g.name;
$$;

grant execute on function public.profile_servers(text) to anon, authenticated;

-- Badges over the same shared servers, all time: busiest channel, most used reaction and the
-- longest run of days with a message. Security invoker, like profile_servers().
create or replace function public.profile_badges(u text)
returns table (
    channel_name text, channel_guild text,
    emoji_key text, emoji_id text, emoji_name text, emoji_animated boolean,
    longest_streak integer
)
language sql
stable
security invoker
set search_path = ''
as $$
    with shared as (
        select a.guild_id from public.guild_members a
        join public.guild_members b on b.guild_id = a.guild_id and b.user_id = public.current_discord_id()
        where a.user_id = u and public.can_see_profile(u)
    ),
    channel as (
        select ch.name, g.name as guild_name from public.member_channel_counts c
        join shared s on s.guild_id = c.guild_id
        join public.channels ch on ch.guild_id = c.guild_id and ch.channel_id = c.channel_id
        join public.guilds g on g.guild_id = c.guild_id
        where c.user_id = u
        group by ch.guild_id, ch.channel_id, ch.name, g.name
        order by sum(c.count) desc, ch.name
        limit 1
    ),
    emoji as (
        select e.emoji_key, e.emoji_id, e.name, e.animated from public.member_emoji_counts c
        join shared s on s.guild_id = c.guild_id
        join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
        where c.user_id = u
        -- Unicode emoji are the same in every server, so they add up across servers.
        group by e.emoji_key, e.emoji_id, e.name, e.animated
        order by sum(c.count) desc, e.emoji_key
        limit 1
    ),
    days as (
        select distinct c.day from public.message_counts c
        join shared s on s.guild_id = c.guild_id
        where c.user_id = u and c.count > 0
    ),
    streak as (
        -- Consecutive days share day - row_number().
        select max(n)::integer as longest from (
            select count(*) as n from (select day, day - (row_number() over (order by day))::integer as run from days) d
            group by run
        ) runs
    )
    select channel.name, channel.guild_name, emoji.emoji_key, emoji.emoji_id, emoji.name, emoji.animated, streak.longest
    from streak
    left join channel on true
    left join emoji on true
    where exists (select from shared);
$$;

grant execute on function public.profile_badges(text) to anon, authenticated;

-- The profile page's setting: the visitor's own row only, never anyone else's. Security
-- definer because the table has no write policies; the bot writes it too, for /profile.
create or replace function public.set_profile_visibility(v text)
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
    insert into public.profiles (user_id, visibility) values (me, v)
    on conflict (user_id) do update set visibility = excluded.visibility, updated_at = now();
end;
$$;

revoke execute on function public.set_profile_visibility(text) from public, anon;
grant execute on function public.set_profile_visibility(text) to authenticated;
