-- Weekly report card the bot posts to Discord every Monday.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.

-- Weeks already posted, so a restart does not post the same report twice. The bot inserts
-- the row before posting; the primary key makes a second insert for the same week fail.
create table if not exists public.report_cards (
    week date primary key,  -- Monday (UTC) of the week the report covers
    posted_at timestamptz not null default now()
);

alter table public.report_cards enable row level security;

create policy "public read" on public.report_cards for select to anon, authenticated using (true);

-- Everything the report shows for the UTC week starting `week_start`, bounded on both
-- ends so a report posted late does not count days of the next week. `not m.hidden`
-- explicitly: the bot calls this with the secret key, which bypasses RLS.
create or replace function public.report_card(week_start date)
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
                join public.members m on m.user_id = c.user_id
                where not m.hidden and c.day >= week_start and c.day < week_start + 7
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
                join public.channels ch on ch.channel_id = c.channel_id
                where c.hour >= week_start::timestamp at time zone 'UTC'
                  and c.hour < (week_start + 7)::timestamp at time zone 'UTC'
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
                join public.emojis e on e.emoji_key = c.emoji_key
                where c.day >= week_start and c.day < week_start + 7
                group by e.emoji_key, e.emoji_id, e.name, e.animated
                order by reaction_count desc, e.emoji_key
                limit 1
            ) t
        ),
        'joins', (
            select coalesce(sum(f.joins), 0) from public.member_flow f
            where f.day >= week_start and f.day < week_start + 7
        ),
        'leaves', (
            select coalesce(sum(f.leaves), 0) from public.member_flow f
            where f.day >= week_start and f.day < week_start + 7
        )
    );
$$;

-- Only the bot needs it; the website has its own functions.
revoke execute on function public.report_card(date) from public, anon, authenticated;
grant execute on function public.report_card(date) to service_role;
