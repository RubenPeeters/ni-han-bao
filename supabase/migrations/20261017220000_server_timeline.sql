-- Member count per day, joins and leaves per day, and voice time per member per day for
-- the server timeline. Same convention as bot_status: RLS on, anon may only SELECT, only
-- the bot writes. Counts, ids and timestamps only.
create table if not exists public.member_count_days (
    day date primary key,  -- UTC day
    member_count integer not null check (member_count >= 0),  -- last count seen that day
    updated_at timestamptz not null default now()
);

alter table public.member_count_days enable row level security;

create policy "public read" on public.member_count_days for select to anon, authenticated using (true);

-- Server-wide totals: nothing here says who joined or left.
create table if not exists public.member_flow (
    day date primary key,  -- UTC day
    joins integer not null default 0 check (joins >= 0),
    leaves integer not null default 0 check (leaves >= 0)
);

alter table public.member_flow enable row level security;

create policy "public read" on public.member_flow for select to anon, authenticated using (true);

create table if not exists public.voice_seconds (
    user_id text not null references public.members (user_id),
    day date not null,  -- UTC day
    seconds integer not null check (seconds >= 0),
    primary key (user_id, day)
);

create index if not exists voice_seconds_day on public.voice_seconds (day);

alter table public.voice_seconds enable row level security;

-- Like message_counts: a hidden member's rows would still expose their user id.
create policy "public read" on public.voice_seconds for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.user_id = voice_seconds.user_id and not m.hidden
    )
);

-- increment_activity plus voice time and joins/leaves, applied in one transaction under one
-- batch id, so a retried flush is a no-op for all of them. increment_activity and
-- increment_message_counts stay for bots still running an earlier release (shared database,
-- see CLAUDE.md); all record their ids in applied_count_batches, and uuids never collide.
create or replace function public.apply_activity(
    batch uuid,
    counts jsonb,
    channel_counts jsonb,
    voice_seconds jsonb,
    member_flow jsonb
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

    insert into public.message_counts (user_id, day, count)
    select c.user_id, c.day, c.count
    from jsonb_to_recordset(counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.message_counts.count + excluded.count;

    insert into public.channel_message_counts (channel_id, hour, count)
    select c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (channel_id, hour)
    do update set count = public.channel_message_counts.count + excluded.count;

    insert into public.voice_seconds (user_id, day, seconds)
    select v.user_id, v.day, v.seconds
    from jsonb_to_recordset(voice_seconds) as v(user_id text, day date, seconds integer)
    on conflict (user_id, day)
    do update set seconds = public.voice_seconds.seconds + excluded.seconds;

    insert into public.member_flow (day, joins, leaves)
    select f.day, f.joins, f.leaves
    from jsonb_to_recordset(member_flow) as f(day date, joins integer, leaves integer)
    on conflict (day)
    do update set
        joins = public.member_flow.joins + excluded.joins,
        leaves = public.member_flow.leaves + excluded.leaves;
end;
$$;

revoke execute on function public.apply_activity(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_activity(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

-- Joins and leaves per ISO week (starting Monday, UTC) since `since`. Weeks without any
-- are left out; the site fills in zeros.
create or replace function public.member_flow_weekly(since date)
returns table (week date, joins bigint, leaves bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select date_trunc('week', f.day)::date as week, sum(f.joins)::bigint, sum(f.leaves)::bigint
    from public.member_flow f
    where f.day >= since
    group by 1
    order by 1;
$$;

grant execute on function public.member_flow_weekly(date) to anon, authenticated;

-- Top members by voice time since `since` (UTC day, inclusive). `not m.hidden` on top of
-- RLS, like leaderboard(), so a caller that bypasses RLS still gets no hidden members.
create or replace function public.top_voice(since date, top integer default 10)
returns table (user_id text, display_name text, avatar_url text, seconds bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(v.seconds)::bigint as seconds
    from public.voice_seconds v
    join public.members m on m.user_id = v.user_id
    where not m.hidden and v.day >= since
    group by m.user_id, m.display_name, m.avatar_url
    order by seconds desc, m.display_name
    limit top;
$$;

grant execute on function public.top_voice(date, integer) to anon, authenticated;
