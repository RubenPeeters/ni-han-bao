-- Emoji and reaction counts for the /emoji page.
-- Same convention as bot_status: RLS on, anon may only SELECT, only the bot writes.
-- Counts only: no message content, and emoji counts do not say who reacted. Only reactions
-- added are counted; the bot ignores removals.
create table if not exists public.emojis (
    -- A custom emoji's id, or the unicode emoji itself.
    emoji_key text primary key,
    emoji_id text,  -- custom emoji only, for the Discord CDN image
    name text,      -- latest known name; null for a custom emoji Discord sent no name for
    animated boolean not null default false,
    updated_at timestamptz not null default now(),
    check (emoji_id is null or emoji_id = emoji_key),
    check (emoji_id is not null or name = emoji_key)
);

alter table public.emojis enable row level security;

create policy "public read" on public.emojis for select to anon, authenticated using (true);

create table if not exists public.emoji_counts (
    emoji_key text not null references public.emojis (emoji_key),
    day date not null,  -- UTC day
    count integer not null check (count >= 0),
    primary key (emoji_key, day)
);

alter table public.emoji_counts enable row level security;

create policy "public read" on public.emoji_counts for select to anon, authenticated using (true);

-- Reactions on each member's messages (other than their own), per UTC day.
create table if not exists public.reactions_received (
    user_id text not null references public.members (user_id),
    day date not null,  -- UTC day
    count integer not null check (count >= 0),
    primary key (user_id, day)
);

alter table public.reactions_received enable row level security;

-- Like message_counts: a hidden member's rows would still expose their user id.
create policy "public read" on public.reactions_received for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.user_id = reactions_received.user_id and not m.hidden
    )
);

-- Emoji names and both kinds of counts in one transaction under one batch id, so a retried
-- flush is a no-op. Batch ids share applied_count_batches with the message counts; uuids
-- never collide, so neither can skip the other's batches.
create or replace function public.increment_reactions(
    batch uuid, emojis jsonb, emoji_counts jsonb, received_counts jsonb
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

    insert into public.emojis (emoji_key, emoji_id, name, animated)
    select e.emoji_key, e.emoji_id, e.name, coalesce(e.animated, false)
    from jsonb_to_recordset(emojis) as e(emoji_key text, emoji_id text, name text, animated boolean)
    on conflict (emoji_key)
    -- A missing name must not wipe out the one already known.
    do update set
        name = coalesce(excluded.name, public.emojis.name),
        animated = excluded.animated,
        updated_at = now();

    insert into public.emoji_counts (emoji_key, day, count)
    select c.emoji_key, c.day, c.count
    from jsonb_to_recordset(emoji_counts) as c(emoji_key text, day date, count integer)
    on conflict (emoji_key, day)
    do update set count = public.emoji_counts.count + excluded.count;

    insert into public.reactions_received (user_id, day, count)
    select c.user_id, c.day, c.count
    from jsonb_to_recordset(received_counts) as c(user_id text, day date, count integer)
    on conflict (user_id, day)
    do update set count = public.reactions_received.count + excluded.count;
end;
$$;

revoke execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb) to service_role;

-- Most used emoji since `since` (UTC day, inclusive), or all time when null.
-- security invoker: sees only what anon can select.
create or replace function public.top_emoji(since date default null, top integer default 10)
returns table (emoji_key text, emoji_id text, name text, animated boolean, reaction_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select e.emoji_key, e.emoji_id, e.name, e.animated, sum(c.count)::bigint as reaction_count
    from public.emoji_counts c
    join public.emojis e on e.emoji_key = c.emoji_key
    where since is null or c.day >= since
    group by e.emoji_key, e.emoji_id, e.name, e.animated
    order by reaction_count desc, e.emoji_key
    limit top;
$$;

grant execute on function public.top_emoji(date, integer) to anon, authenticated;

-- Members whose messages got the most reactions. `not m.hidden` on top of RLS, so a
-- caller that bypasses RLS still gets no hidden members from it.
create or replace function public.most_reacted_members(since date default null, top integer default 10)
returns table (user_id text, display_name text, avatar_url text, reaction_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as reaction_count
    from public.reactions_received c
    join public.members m on m.user_id = c.user_id
    where not m.hidden and (since is null or c.day >= since)
    group by m.user_id, m.display_name, m.avatar_url
    order by reaction_count desc, m.display_name
    limit top;
$$;

grant execute on function public.most_reacted_members(date, integer) to anon, authenticated;
