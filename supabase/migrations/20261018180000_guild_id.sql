-- Multi-server, part 1: every per-server table carries guild_id. Behaviour is unchanged.
-- The default is The Think Tank, the only server so far: it backfills existing rows and
-- keeps inserts from the bot on main (which sends no guild_id) working. The existing
-- primary keys stay until part 3, so the old bot's ON CONFLICT targets still resolve; the
-- unique indexes below are what the keys become then. A superset of a unique key is
-- unique, so building them cannot fail on existing data.

alter table public.members add column if not exists guild_id text not null default '1525456003854897152';
alter table public.message_counts add column if not exists guild_id text not null default '1525456003854897152';
alter table public.channels add column if not exists guild_id text not null default '1525456003854897152';
alter table public.channel_message_counts add column if not exists guild_id text not null default '1525456003854897152';
alter table public.emojis add column if not exists guild_id text not null default '1525456003854897152';
alter table public.emoji_counts add column if not exists guild_id text not null default '1525456003854897152';
alter table public.reactions_received add column if not exists guild_id text not null default '1525456003854897152';
alter table public.member_count_snapshots add column if not exists guild_id text not null default '1525456003854897152';
alter table public.member_flow add column if not exists guild_id text not null default '1525456003854897152';
alter table public.voice_seconds add column if not exists guild_id text not null default '1525456003854897152';
alter table public.report_cards add column if not exists guild_id text not null default '1525456003854897152';

-- bot_status has had guild_id since it was created; it still holds a single row.
create unique index if not exists bot_status_guild on public.bot_status (guild_id);
create unique index if not exists members_guild_user on public.members (guild_id, user_id);
create unique index if not exists message_counts_guild_user_day on public.message_counts (guild_id, user_id, day);
create unique index if not exists channels_guild_channel on public.channels (guild_id, channel_id);
create unique index if not exists channel_message_counts_guild_channel_hour
    on public.channel_message_counts (guild_id, channel_id, hour);
create unique index if not exists emojis_guild_emoji on public.emojis (guild_id, emoji_key);
create unique index if not exists emoji_counts_guild_emoji_day on public.emoji_counts (guild_id, emoji_key, day);
create unique index if not exists reactions_received_guild_user_day
    on public.reactions_received (guild_id, user_id, day);
create unique index if not exists member_count_snapshots_guild_day on public.member_count_snapshots (guild_id, day);
create unique index if not exists member_flow_guild_day on public.member_flow (guild_id, day);
create unique index if not exists voice_seconds_guild_user_day on public.voice_seconds (guild_id, user_id, day);
create unique index if not exists report_cards_guild_week on public.report_cards (guild_id, week);

-- Every function below gains a trailing `guild` parameter. Callers pass arguments by name
-- (PostgREST), so the default keeps the bot and site on main working. Dropped first rather
-- than overloaded: two candidates would make PostgREST refuse those named calls as ambiguous.
-- One transaction, so no caller ever sees the function missing.

drop function if exists public.increment_activity(uuid, jsonb, jsonb);
create function public.increment_activity(
    batch uuid, counts jsonb, channel_counts jsonb, guild text default '1525456003854897152'
)
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

    insert into public.message_counts (guild_id, user_id, day, count)
    select guild, c.user_id, c.day, c.count
    from jsonb_to_recordset(counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.message_counts.count + excluded.count;

    insert into public.channel_message_counts (guild_id, channel_id, hour, count)
    select guild, c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (channel_id, hour)
    do update set count = public.channel_message_counts.count + excluded.count;
end;
$$;

revoke execute on function public.increment_activity(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_activity(uuid, jsonb, jsonb, text) to service_role;

drop function if exists public.increment_reactions(uuid, jsonb, jsonb, jsonb);
create function public.increment_reactions(
    batch uuid, emojis jsonb, emoji_counts jsonb, received_counts jsonb,
    guild text default '1525456003854897152'
)
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

    insert into public.emojis (guild_id, emoji_key, emoji_id, name, animated)
    select guild, e.emoji_key, e.emoji_id, e.name, coalesce(e.animated, false)
    from jsonb_to_recordset(emojis) as e(emoji_key text, emoji_id text, name text, animated boolean)
    on conflict (emoji_key)
    -- A missing name must not wipe out the one already known.
    do update set
        name = coalesce(excluded.name, public.emojis.name),
        animated = excluded.animated,
        updated_at = now();

    insert into public.emoji_counts (guild_id, emoji_key, day, count)
    select guild, c.emoji_key, c.day, c.count
    from jsonb_to_recordset(emoji_counts) as c(emoji_key text, day date, count integer)
    on conflict (emoji_key, day)
    do update set count = public.emoji_counts.count + excluded.count;

    insert into public.reactions_received (guild_id, user_id, day, count)
    select guild, c.user_id, c.day, c.count
    from jsonb_to_recordset(received_counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.reactions_received.count + excluded.count;
end;
$$;

revoke execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text) to service_role;

drop function if exists public.increment_timeline(uuid, jsonb, jsonb);
create function public.increment_timeline(
    batch uuid, flow jsonb, voice jsonb, guild text default '1525456003854897152'
)
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

    insert into public.member_flow (guild_id, day, joins, leaves)
    select guild, f.day, f.joins, f.leaves
    from jsonb_to_recordset(flow) as f(day date, joins integer, leaves integer)
    on conflict (day)
    do update set
        joins = public.member_flow.joins + excluded.joins,
        leaves = public.member_flow.leaves + excluded.leaves;

    -- least(): a day has only 86400 seconds; anything beyond is a clock glitch, not time
    -- spent, and must not make the whole batch fail its check forever.
    insert into public.voice_seconds (guild_id, user_id, day, seconds)
    select guild, v.user_id, v.day, least(v.seconds, 86400)
    from jsonb_to_recordset(voice) as v(user_id text, day date, seconds integer)
    on conflict (user_id, day)
    do update set seconds = least(public.voice_seconds.seconds + excluded.seconds, 86400);
end;
$$;

revoke execute on function public.increment_timeline(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_timeline(uuid, jsonb, jsonb, text) to service_role;

drop function if exists public.leaderboard(date, integer);
create function public.leaderboard(
    since date default null, top integer default 10, guild text default '1525456003854897152'
)
returns table (user_id text, display_name text, avatar_url text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as message_count
    from public.message_counts c
    join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
    where c.guild_id = guild and not m.hidden and (since is null or c.day >= since)
    group by m.user_id, m.display_name, m.avatar_url
    order by message_count desc, m.display_name
    limit top;
$$;

grant execute on function public.leaderboard(date, integer, text) to anon, authenticated;

drop function if exists public.busiest_channels(timestamptz, integer);
create function public.busiest_channels(
    since timestamptz, top integer default 10, guild text default '1525456003854897152'
)
returns table (channel_id text, name text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select ch.channel_id, ch.name, sum(c.count)::bigint as message_count
    from public.channel_message_counts c
    join public.channels ch on ch.guild_id = c.guild_id and ch.channel_id = c.channel_id
    where c.guild_id = guild and c.hour >= since
    group by ch.channel_id, ch.name
    order by message_count desc, ch.name
    limit top;
$$;

grant execute on function public.busiest_channels(timestamptz, integer, text) to anon, authenticated;

drop function if exists public.channel_heatmap(timestamptz);
create function public.channel_heatmap(since timestamptz, guild text default '1525456003854897152')
returns table (weekday integer, hour integer, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        extract(isodow from c.hour at time zone 'UTC')::integer as weekday,
        extract(hour from c.hour at time zone 'UTC')::integer as hour,
        sum(c.count)::bigint as message_count
    from public.channel_message_counts c
    where c.guild_id = guild and c.hour >= since
    group by 1, 2;
$$;

grant execute on function public.channel_heatmap(timestamptz, text) to anon, authenticated;

drop function if exists public.top_emoji(date, integer);
create function public.top_emoji(
    since date default null, top integer default 10, guild text default '1525456003854897152'
)
returns table (emoji_key text, emoji_id text, name text, animated boolean, reaction_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select e.emoji_key, e.emoji_id, e.name, e.animated, sum(c.count)::bigint as reaction_count
    from public.emoji_counts c
    join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
    where c.guild_id = guild and (since is null or c.day >= since)
    group by e.emoji_key, e.emoji_id, e.name, e.animated
    order by reaction_count desc, e.emoji_key
    limit top;
$$;

grant execute on function public.top_emoji(date, integer, text) to anon, authenticated;

drop function if exists public.most_reacted_members(date, integer);
create function public.most_reacted_members(
    since date default null, top integer default 10, guild text default '1525456003854897152'
)
returns table (user_id text, display_name text, avatar_url text, reaction_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as reaction_count
    from public.reactions_received c
    join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
    where c.guild_id = guild and not m.hidden and (since is null or c.day >= since)
    group by m.user_id, m.display_name, m.avatar_url
    order by reaction_count desc, m.display_name
    limit top;
$$;

grant execute on function public.most_reacted_members(date, integer, text) to anon, authenticated;

drop function if exists public.weekly_member_flow(date);
create function public.weekly_member_flow(since date, guild text default '1525456003854897152')
returns table (week date, joins bigint, leaves bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        date_trunc('week', f.day)::date as week,
        sum(f.joins)::bigint as joins,
        sum(f.leaves)::bigint as leaves
    from public.member_flow f
    where f.guild_id = guild and f.day >= since
    group by 1
    order by 1;
$$;

grant execute on function public.weekly_member_flow(date, text) to anon, authenticated;

drop function if exists public.top_voice_members(date, integer);
create function public.top_voice_members(
    since date, top integer default 10, guild text default '1525456003854897152'
)
returns table (user_id text, display_name text, avatar_url text, voice_minutes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, (sum(v.seconds) / 60)::bigint as voice_minutes
    from public.voice_seconds v
    join public.members m on m.guild_id = v.guild_id and m.user_id = v.user_id
    where v.guild_id = guild and not m.hidden and v.day >= since
    group by m.user_id, m.display_name, m.avatar_url
    having sum(v.seconds) >= 60  -- would show as "0 min"
    -- Seconds, not the rounded minutes, so near-ties still order correctly.
    order by sum(v.seconds) desc, m.display_name
    limit top;
$$;

grant execute on function public.top_voice_members(date, integer, text) to anon, authenticated;

drop function if exists public.report_card(date, date);
create function public.report_card(since date, until date, guild text default '1525456003854897152')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'top_talkers', coalesce((
            select jsonb_agg(t order by t.message_count desc, t.display_name)
            from (
                select m.display_name, sum(c.count)::bigint as message_count
                from public.message_counts c
                join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
                where c.guild_id = guild and not m.hidden and c.day >= since and c.day < until
                group by m.user_id, m.display_name
                order by message_count desc, m.display_name
                limit 3
            ) t
        ), '[]'::jsonb),
        'busiest_channel', (
            select to_jsonb(t)
            from (
                select ch.name, sum(c.count)::bigint as message_count
                from public.channel_message_counts c
                join public.channels ch on ch.guild_id = c.guild_id and ch.channel_id = c.channel_id
                where c.guild_id = guild
                  and c.hour >= since::timestamp at time zone 'UTC'
                  and c.hour < until::timestamp at time zone 'UTC'
                group by ch.channel_id, ch.name
                order by message_count desc, ch.name
                limit 1
            ) t
        ),
        'top_emoji', (
            select to_jsonb(t)
            from (
                select e.emoji_key, e.emoji_id, e.name, e.animated, sum(c.count)::bigint as reaction_count
                from public.emoji_counts c
                join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
                where c.guild_id = guild and c.day >= since and c.day < until
                group by e.emoji_key, e.emoji_id, e.name, e.animated
                order by reaction_count desc, e.emoji_key
                limit 1
            ) t
        ),
        'joins', (
            select coalesce(sum(f.joins), 0) from public.member_flow f
            where f.guild_id = guild and f.day >= since and f.day < until
        ),
        'leaves', (
            select coalesce(sum(f.leaves), 0) from public.member_flow f
            where f.guild_id = guild and f.day >= since and f.day < until
        )
    );
$$;

revoke execute on function public.report_card(date, date, text) from public, anon, authenticated;
grant execute on function public.report_card(date, date, text) to service_role;
