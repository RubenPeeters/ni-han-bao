-- Channels and per-hour message counts for the channel heatmap.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Counts only: message content is never stored, and nothing here says who sent what.
create table if not exists public.channels (
    channel_id text primary key,
    name text not null,  -- latest known name; the bot rewrites it on renames
    updated_at timestamptz not null default now()
);

alter table public.channels enable row level security;

create policy "public read" on public.channels for select to anon, authenticated using (true);

create table if not exists public.channel_message_counts (
    channel_id text not null references public.channels (channel_id),
    -- Start of the UTC hour. The check keeps a stray minute from splitting a bucket.
    hour timestamptz not null check (date_trunc('hour', hour at time zone 'UTC') = hour at time zone 'UTC'),
    count integer not null check (count >= 0),
    primary key (channel_id, hour)
);

create index if not exists channel_message_counts_hour on public.channel_message_counts (hour);

alter table public.channel_message_counts enable row level security;

create policy "public read" on public.channel_message_counts for select to anon, authenticated using (true);

-- increment_message_counts plus channel counts, applied in one transaction under one batch
-- id, so a retried flush is a no-op for both. increment_message_counts stays for bots that
-- still run the previous release (shared database, see CLAUDE.md); both record their ids in
-- applied_count_batches, and uuids never collide, so they cannot skip each other's batches.
create or replace function public.increment_activity(batch uuid, counts jsonb, channel_counts jsonb)
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
end;
$$;

revoke execute on function public.increment_activity(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.increment_activity(uuid, jsonb, jsonb) to service_role;

-- Channels by messages since `since`. security invoker: sees only what anon can select.
create or replace function public.busiest_channels(since timestamptz, top integer default 10)
returns table (channel_id text, name text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select ch.channel_id, ch.name, sum(c.count)::bigint as message_count
    from public.channel_message_counts c
    join public.channels ch on ch.channel_id = c.channel_id
    where c.hour >= since
    group by ch.channel_id, ch.name
    order by message_count desc, ch.name
    limit top;
$$;

grant execute on function public.busiest_channels(timestamptz, integer) to anon, authenticated;

-- Messages since `since` per UTC weekday (1 = Monday ... 7 = Sunday) and hour of day
-- (0-23), all channels together. Empty cells are left out; the site fills in zeros.
create or replace function public.channel_heatmap(since timestamptz)
returns table (weekday integer, hour integer, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select
        extract(isodow from c.hour at time zone 'UTC')::integer as weekday,
        extract(hour from c.hour at time zone 'UTC')::integer as hour,
        sum(c.count)::bigint as message_count
    from public.channel_message_counts c
    where c.hour >= since
    group by 1, 2;
$$;

grant execute on function public.channel_heatmap(timestamptz) to anon, authenticated;
