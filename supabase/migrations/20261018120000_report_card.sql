-- Weekly report card the bot posts in Discord.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.

-- Weeks whose report card was posted, written after the send. The bot also checks the
-- report channel itself, so a crash between sending and writing this row posts nothing twice.
create table if not exists public.report_cards (
    week date primary key,  -- Monday of the reported UTC week
    posted_at timestamptz not null default now()
);

alter table public.report_cards enable row level security;

create policy "public read" on public.report_cards for select to anon, authenticated using (true);

-- Everything one report card shows, for the UTC days [since, until). `not m.hidden` on top
-- of RLS: the bot calls this with the secret key, which bypasses RLS.
create or replace function public.report_card(since date, until date)
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
                where not m.hidden and c.day >= since and c.day < until
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
                where c.hour >= since::timestamp at time zone 'UTC'
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
                join public.emojis e on e.emoji_key = c.emoji_key
                where c.day >= since and c.day < until
                group by e.emoji_key, e.emoji_id, e.name, e.animated
                order by reaction_count desc, e.emoji_key
                limit 1
            ) t
        ),
        'joins', (select coalesce(sum(f.joins), 0) from public.member_flow f where f.day >= since and f.day < until),
        'leaves', (select coalesce(sum(f.leaves), 0) from public.member_flow f where f.day >= since and f.day < until)
    );
$$;

revoke execute on function public.report_card(date, date) from public, anon, authenticated;
grant execute on function public.report_card(date, date) to service_role;
