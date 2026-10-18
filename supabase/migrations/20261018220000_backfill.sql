-- State of the one-off history backfill (bot/src/backfill.ts).
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Holds ids and timestamps only: message content is never stored.
--
-- `before_id` splits live counting from the backfill: the live bot counts messages at or
-- after it, the backfill those before it (see backfillBefore in bot/src/history.ts), so
-- history counts are simply added to message_counts and channel_message_counts.

-- One row per server, stored by whichever of live bot and backfill runs first: once counts
-- exist on both sides of it, the counts no longer say where it was.
create table if not exists public.backfill_state (
    guild_id text primary key,
    before_id text not null,
    created_at timestamptz not null default now()
);

alter table public.backfill_state enable row level security;

create policy "public read" on public.backfill_state for select to anon, authenticated using (true);

-- One row per channel or thread read.
create table if not exists public.backfill_cursors (
    guild_id text not null,
    channel_id text not null,
    -- Oldest message id already counted (before the first page: backfill_state.before_id).
    -- Only messages older than this are still to be read.
    before_id text not null,
    done boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (guild_id, channel_id)
);

alter table public.backfill_cursors enable row level security;

create policy "public read" on public.backfill_cursors for select to anon, authenticated using (true);

-- Adds one page of history counts and moves the channel's cursor past it, in one
-- transaction. The cursor must still be where the page started (compare-and-set), so a
-- retried, rerun or concurrent page is a no-op instead of a double count. Returns whether
-- it applied. Conflict targets match increment_activity's.
create or replace function public.backfill_page(
    guild text,
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
    where guild_id = guild and channel_id = channel and before_id = before and not done;
    if not found then
        return false;
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

    return true;
end;
$$;

revoke execute on function public.backfill_page(text, text, text, text, boolean, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.backfill_page(text, text, text, text, boolean, jsonb, jsonb) to service_role;
