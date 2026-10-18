-- Monthly recap card (#75): the bot posts an image of last month's stats, drawn by the site
-- at /s/[guildId]/recap/[month]/og. Additive only.

-- One row per recap the bot has asked the site to draw. The bot has no session, so it
-- fetches the image with `key`: whoever holds it may see that one month of that one server,
-- which is what the bot then posts in the server anyway. Members could read the key too,
-- but it shows them nothing they cannot see logged in.
create table if not exists public.monthly_recaps (
    guild_id text not null,
    month date not null,  -- first day of the month, in the server's time zone
    key uuid not null default gen_random_uuid(),
    -- Null until the 1st-of-the-month post went out; /recap leaves it as it is.
    posted_at timestamptz,
    primary key (guild_id, month)
);

alter table public.monthly_recaps enable row level security;

create policy "members read" on public.monthly_recaps for select to authenticated
    using (public.is_guild_member(guild_id));

-- Everything one recap card shows, for the month starting at `month` in the server's time
-- zone. Null unless the caller is a member of `guild` or holds that month's key. Security
-- definer so a member and the bot's key get the very same numbers: totals come from channel
-- counts (no person in them), and hidden members are left out of top_talkers by hand.
create or replace function public.monthly_recap(guild text, month date, recap_key uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with s as (
        select coalesce((select g.timezone from public.guild_settings g where g.guild_id = guild), 'UTC') as tz
    ),
    hours as (
        select c.hour at time zone s.tz as local, c.count, c.channel_id
        from public.channel_message_counts c, s
        where c.guild_id = guild
          and c.hour >= month::timestamp at time zone s.tz
          and c.hour < (month + interval '1 month')::timestamp at time zone s.tz
    )
    select jsonb_build_object(
        'server', (select g.name from public.guilds g where g.guild_id = guild),
        'top_talkers', coalesce((
            select jsonb_agg(t order by t.message_count desc, t.display_name)
            from (
                select m.display_name, sum(c.count)::bigint as message_count
                from public.message_counts c
                join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
                where c.guild_id = guild and not m.hidden
                  and c.day >= month and c.day < month + interval '1 month'
                group by m.user_id, m.display_name
                order by message_count desc, m.display_name
                limit 3
            ) t
        ), '[]'::jsonb),
        'busiest_channel', (
            select to_jsonb(t) from (
                select ch.name, sum(h.count)::bigint as message_count
                from hours h
                join public.channels ch on ch.guild_id = guild and ch.channel_id = h.channel_id
                group by ch.channel_id, ch.name
                order by message_count desc, ch.name
                limit 1
            ) t
        ),
        'top_emoji', (
            select to_jsonb(t) from (
                select e.emoji_key, e.emoji_id, e.name, e.animated, sum(c.count)::bigint as reaction_count
                from public.emoji_counts c
                join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
                where c.guild_id = guild and c.day >= month and c.day < month + interval '1 month'
                group by e.emoji_key, e.emoji_id, e.name, e.animated
                order by reaction_count desc, e.emoji_key
                limit 1
            ) t
        ),
        'peak_hour', (
            select extract(hour from h.local)::integer from hours h
            group by 1 order by sum(h.count) desc, 1 limit 1
        ),
        'busiest_day', (
            select to_jsonb(t) from (
                select h.local::date as day, sum(h.count)::bigint as message_count from hours h
                group by 1 order by message_count desc, day limit 1
            ) t
        ),
        'messages', (select coalesce(sum(h.count), 0)::bigint from hours h)
    )
    where public.is_guild_member(guild) or exists (
        select from public.monthly_recaps r
        where r.guild_id = guild and r.month = monthly_recap.month and r.key = recap_key
    );
$$;

revoke execute on function public.monthly_recap(text, date, uuid) from public;
grant execute on function public.monthly_recap(text, date, uuid) to anon, authenticated, service_role;
