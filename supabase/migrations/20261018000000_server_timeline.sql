-- Member count, joins and leaves, and voice time for the /timeline page.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Counts and durations only; joins and leaves do not say who joined or left.

-- The server's member count per UTC day. The bot overwrites today's row as the count
-- changes, so a past day holds the last count the bot saw that day.
create table if not exists public.member_count_snapshots (
    day date primary key,  -- UTC day
    member_count integer not null check (member_count >= 0),
    updated_at timestamptz not null default now()
);

alter table public.member_count_snapshots enable row level security;

create policy "public read" on public.member_count_snapshots for select to anon, authenticated using (true);

create table if not exists public.member_flow (
    day date primary key,  -- UTC day
    joins integer not null default 0 check (joins >= 0),
    leaves integer not null default 0 check (leaves >= 0)
);

alter table public.member_flow enable row level security;

create policy "public read" on public.member_flow for select to anon, authenticated using (true);

-- Seconds rather than minutes, so the short slices the bot flushes do not each round away.
create table if not exists public.voice_seconds (
    user_id text not null references public.members (user_id),
    day date not null,  -- UTC day
    seconds integer not null check (seconds >= 0 and seconds <= 86400),
    primary key (user_id, day)
);

alter table public.voice_seconds enable row level security;

-- Like message_counts: a hidden member's rows would still expose their user id.
create policy "public read" on public.voice_seconds for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.user_id = voice_seconds.user_id and not m.hidden
    )
);

-- Joins, leaves and voice time in one transaction under one batch id, so a retried flush
-- is a no-op. Batch ids share applied_count_batches with the other counts; uuids never
-- collide, so none can skip another's batches.
create or replace function public.increment_timeline(batch uuid, flow jsonb, voice jsonb)
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

    insert into public.member_flow (day, joins, leaves)
    select f.day, f.joins, f.leaves
    from jsonb_to_recordset(flow) as f(day date, joins integer, leaves integer)
    on conflict (day)
    do update set
        joins = public.member_flow.joins + excluded.joins,
        leaves = public.member_flow.leaves + excluded.leaves;

    -- least(): a day has only 86400 seconds; anything beyond is a clock glitch, not time
    -- spent, and must not make the whole batch fail its check forever.
    insert into public.voice_seconds (user_id, day, seconds)
    select v.user_id, v.day, least(v.seconds, 86400)
    from jsonb_to_recordset(voice) as v(user_id text, day date, seconds integer)
    on conflict (user_id, day)
    do update set seconds = least(public.voice_seconds.seconds + excluded.seconds, 86400);
end;
$$;

revoke execute on function public.increment_timeline(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.increment_timeline(uuid, jsonb, jsonb) to service_role;

-- Joins and leaves per ISO week (starting Monday, UTC) since `since`. Weeks without any
-- are left out; the site fills in zeros.
create or replace function public.weekly_member_flow(since date)
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
    where f.day >= since
    group by 1
    order by 1;
$$;

grant execute on function public.weekly_member_flow(date) to anon, authenticated;

-- Members with the most voice time since `since`. `not m.hidden` on top of RLS, so a
-- caller that bypasses RLS still gets no hidden members from it.
create or replace function public.top_voice_members(since date, top integer default 10)
returns table (user_id text, display_name text, avatar_url text, voice_minutes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, (sum(v.seconds) / 60)::bigint as voice_minutes
    from public.voice_seconds v
    join public.members m on m.user_id = v.user_id
    where not m.hidden and v.day >= since
    group by m.user_id, m.display_name, m.avatar_url
    having sum(v.seconds) >= 60  -- would show as "0 min"
    -- Seconds, not the rounded minutes, so near-ties still order correctly.
    order by sum(v.seconds) desc, m.display_name
    limit top;
$$;

grant execute on function public.top_voice_members(date, integer) to anon, authenticated;
