-- State of the one-off history backfill (bot/src/backfill.ts).
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Holds ids and counts only: message content is never stored.
--
-- The stored counts cannot say which messages the live bot already counted (it may have
-- started mid-hour, been down for a while, or counted per day before per hour). So the
-- backfill counts *every* message before a fixed, day-aligned cutoff into the backfill_*
-- tables, and backfill_apply() raises each live bucket to at least the history's count for
-- it. A bucket entirely before the cutoff is complete in the history, so the larger of the
-- two is the true count (the live one only wins when messages were deleted since): nothing
-- is double-counted and nothing before the first live count is lost.

-- Single row: the cutoff chosen by the first run. Later runs reuse it, so a channel that
-- only becomes readable later is still counted up to the same moment.
create table if not exists public.backfill_state (
    id smallint primary key default 1 check (id = 1),
    -- Start of a UTC day that had already ended when the first run began, so the live bot
    -- never adds to a bucket before it again.
    cutoff timestamptz not null
);

alter table public.backfill_state enable row level security;

create policy "public read" on public.backfill_state for select to anon, authenticated using (true);

-- One row per channel or thread.
create table if not exists public.backfill_cursors (
    channel_id text primary key,
    -- Oldest message id already counted; before the first page, the snowflake of the cutoff.
    -- The backfill only reads messages older than this.
    before_id text not null,
    done boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.backfill_cursors enable row level security;

create policy "public read" on public.backfill_cursors for select to anon, authenticated using (true);

-- History counts, same shape as message_counts and channel_message_counts. No foreign keys:
-- backfill_apply() copies them into the tables that have them.
create table if not exists public.backfill_message_counts (
    user_id text not null,
    day date not null,
    count integer not null check (count >= 0),
    primary key (user_id, day)
);

alter table public.backfill_message_counts enable row level security;

-- Same rule as message_counts: a hidden member's counts would expose their user id.
create policy "public read" on public.backfill_message_counts for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.user_id = backfill_message_counts.user_id and not m.hidden
    )
);

create table if not exists public.backfill_channel_message_counts (
    channel_id text not null,
    hour timestamptz not null,
    count integer not null check (count >= 0),
    primary key (channel_id, hour)
);

alter table public.backfill_channel_message_counts enable row level security;

create policy "public read" on public.backfill_channel_message_counts for select to anon, authenticated using (true);

-- Adds one page of history counts and moves the channel's cursor past it, in one
-- transaction. The cursor must still be where the page started (compare-and-set), so a
-- retried or concurrent page is a no-op instead of a double count. Returns whether it applied.
create or replace function public.backfill_page(
    channel text,
    before text,
    next_before text,
    finished boolean,
    counts jsonb,
    channel_counts jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
    update public.backfill_cursors
    set before_id = next_before, done = finished, updated_at = now()
    where channel_id = channel and before_id = before and not done;
    if not found then
        return false;
    end if;

    insert into public.backfill_message_counts (user_id, day, count)
    select c.user_id, c.day, c.count
    from jsonb_to_recordset(counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.backfill_message_counts.count + excluded.count;

    insert into public.backfill_channel_message_counts (channel_id, hour, count)
    select c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (channel_id, hour)
    do update set count = public.backfill_channel_message_counts.count + excluded.count;

    return true;
end;
$$;

-- Raises every live bucket to the history's count for it. The backfill_* counts only grow,
-- so running this after every run (even an unfinished one) is safe and idempotent.
create or replace function public.backfill_apply()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    insert into public.message_counts (user_id, day, count)
    select user_id, day, count from public.backfill_message_counts
    on conflict (user_id, day)
    do update set count = greatest(public.message_counts.count, excluded.count);

    insert into public.channel_message_counts (channel_id, hour, count)
    select channel_id, hour, count from public.backfill_channel_message_counts
    on conflict (channel_id, hour)
    do update set count = greatest(public.channel_message_counts.count, excluded.count);
end;
$$;

revoke execute on function public.backfill_page(text, text, text, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.backfill_page(text, text, text, boolean, jsonb, jsonb) to service_role;
revoke execute on function public.backfill_apply() from public, anon, authenticated;
grant execute on function public.backfill_apply() to service_role;
