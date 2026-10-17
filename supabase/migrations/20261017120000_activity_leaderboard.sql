-- Members and per-UTC-day message counts for the activity leaderboard.
-- Only counts are stored, never message content.
create table if not exists public.members (
    user_id text primary key,
    display_name text not null,
    avatar_url text,
    updated_at timestamptz not null default now()
);

alter table public.members enable row level security;

create policy "public read" on public.members for select to anon, authenticated using (true);

create table if not exists public.message_counts (
    user_id text not null references public.members (user_id),
    day date not null,  -- UTC
    count integer not null check (count >= 0),
    primary key (user_id, day)
);

alter table public.message_counts enable row level security;

create policy "public read" on public.message_counts for select to anon, authenticated using (true);

-- The bot flushes buffered increments in one call. Adding in SQL (instead of the bot reading,
-- summing and writing back) keeps concurrent flushes from losing counts.
create or replace function public.increment_message_counts(p_rows jsonb)
returns void
language sql
set search_path = ''
as $$
    insert into public.message_counts (user_id, day, count)
    select r.user_id, r.day, sum(r.count)
    from jsonb_to_recordset(p_rows) as r(user_id text, day date, count integer)
    group by r.user_id, r.day
    on conflict (user_id, day)
    do update set count = public.message_counts.count + excluded.count;
$$;

-- Supabase grants execute on new functions to the website roles by default; only the bot may write.
revoke execute on function public.increment_message_counts(jsonb) from public, anon, authenticated;
grant execute on function public.increment_message_counts(jsonb) to service_role;

-- PostgREST cannot aggregate by default, so the site reads these views.
-- security_invoker makes the views obey the RLS of the tables underneath.
create or replace view public.leaderboard_all_time with (security_invoker = true) as
select m.user_id, m.display_name, m.avatar_url, sum(c.count)::integer as message_count
from public.message_counts c
join public.members m using (user_id)
group by m.user_id, m.display_name, m.avatar_url;

-- date_trunc('week', ...) starts weeks on Monday.
create or replace view public.leaderboard_this_week with (security_invoker = true) as
select m.user_id, m.display_name, m.avatar_url, sum(c.count)::integer as message_count
from public.message_counts c
join public.members m using (user_id)
where c.day >= date_trunc('week', now() at time zone 'utc')::date
group by m.user_id, m.display_name, m.avatar_url;
