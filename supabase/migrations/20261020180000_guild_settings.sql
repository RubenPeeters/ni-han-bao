-- Per-server settings (#69), set with /setup by members with Manage Server.
-- Additive only: the previous release keeps working against it (the functions below keep
-- their old arguments, and the new `tz` defaults to UTC, which is what they did before).

-- Kept when the bot leaves (like welcome_messages), so a re-invite keeps its setup.
create table if not exists public.guild_settings (
    guild_id text primary key,
    -- Null: no weekly report card.
    report_channel_id text,
    -- IANA name; the bot checks it before writing. Days stored elsewhere stay UTC days.
    timezone text not null default 'UTC',
    updated_at timestamptz not null default now()
);

alter table public.guild_settings enable row level security;

create policy "members read" on public.guild_settings for select to authenticated
    using (public.is_guild_member(guild_id));

-- The Think Tank's report went out at 09:00 Brussels time; keep that. Its report channel
-- is set with /setup report-channel, which replaces the REPORT_CHANNEL_ID env var.
insert into public.guild_settings (guild_id, timezone)
values ('1525456003854897152', 'Europe/Brussels')
on conflict (guild_id) do nothing;

-- Weekday and hour in the server's time zone. Dropped first rather than overloaded: two
-- candidates would make PostgREST refuse named calls as ambiguous.
drop function if exists public.channel_heatmap(timestamptz, text);
create function public.channel_heatmap(
    since timestamptz, guild text default '1525456003854897152', tz text default 'UTC'
)
returns table (weekday integer, hour integer, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        extract(isodow from c.hour at time zone tz)::integer as weekday,
        extract(hour from c.hour at time zone tz)::integer as hour,
        sum(c.count)::bigint as message_count
    from public.channel_message_counts c
    where c.guild_id = guild and c.hour >= since
    group by 1, 2;
$$;

grant execute on function public.channel_heatmap(timestamptz, text, text) to anon, authenticated;

-- Everything one report card shows, for the days [since, until) in the server's time zone.
-- shortcut: message, emoji and flow counts are stored per UTC day, so their window is off by
-- the zone's UTC offset; only the hourly channel counts follow it exactly. Store local days
-- if that ever matters.
drop function if exists public.report_card(date, date, text);
create function public.report_card(
    since date, until date, guild text default '1525456003854897152', tz text default 'UTC'
)
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
                  and c.hour >= since::timestamp at time zone tz
                  and c.hour < until::timestamp at time zone tz
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

revoke execute on function public.report_card(date, date, text, text) from public, anon, authenticated;
grant execute on function public.report_card(date, date, text, text) to service_role;
