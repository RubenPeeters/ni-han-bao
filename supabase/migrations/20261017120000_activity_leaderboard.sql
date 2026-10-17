-- Members and per-day message counts for the activity leaderboard.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Counts only: message content is never stored.
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
    day date not null,  -- UTC day
    count integer not null check (count >= 0),
    primary key (user_id, day)
);

alter table public.message_counts enable row level security;

create policy "public read" on public.message_counts for select to anon, authenticated using (true);

-- Ids of count batches already applied. A flush whose response is lost is retried with
-- the same id; recording the id in the same transaction as the increment makes that
-- retry a no-op instead of a double count. Holds ids and timestamps only.
create table if not exists public.applied_count_batches (
    batch_id uuid primary key,
    applied_at timestamptz not null default now()
);

alter table public.applied_count_batches enable row level security;

create policy "public read" on public.applied_count_batches for select to anon, authenticated using (true);

-- The bot flushes buffered counts through this function so each increment happens inside
-- one INSERT ... ON CONFLICT statement: no read-modify-write race between flushes.
create or replace function public.increment_message_counts(batch uuid, counts jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into public.applied_count_batches (batch_id) values (batch) on conflict do nothing;
    if not found then
        return;  -- already applied by an earlier attempt
    end if;

    insert into public.message_counts (user_id, day, count)
    select c.user_id, c.day, c.count
    from jsonb_to_recordset(counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.message_counts.count + excluded.count;
end;
$$;

-- Writes are for the bot only (service_role); the website must not be able to call this.
revoke execute on function public.increment_message_counts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.increment_message_counts(uuid, jsonb) to service_role;

-- Top members by messages since `since` (UTC day, inclusive), or all time when null.
-- security invoker: runs under the caller's RLS, so it can only see what anon can select.
create or replace function public.leaderboard(since date default null, top integer default 10)
returns table (user_id text, display_name text, avatar_url text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as message_count
    from public.message_counts c
    join public.members m on m.user_id = c.user_id
    where since is null or c.day >= since
    group by m.user_id, m.display_name, m.avatar_url
    order by message_count desc, m.display_name
    limit top;
$$;

grant execute on function public.leaderboard(date, integer) to anon, authenticated;
