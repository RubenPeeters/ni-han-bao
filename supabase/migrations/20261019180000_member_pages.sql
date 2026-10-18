-- Member pages (#57): each member's top channels and the emoji they react with. The
-- existing channel and emoji counts are per server only, so two per-member tables join
-- them. Additive: the write functions gain parameters that default to empty, so the bot on
-- main keeps calling them unchanged until this release reaches it.

create table if not exists public.member_channel_counts (
    guild_id text not null,
    user_id text not null,
    channel_id text not null,  -- a thread's messages count toward its parent, as in channel_message_counts
    day date not null,  -- UTC day
    count integer not null check (count >= 0),
    primary key (guild_id, user_id, channel_id, day),
    foreign key (guild_id, user_id) references public.members (guild_id, user_id),
    foreign key (guild_id, channel_id) references public.channels (guild_id, channel_id)
);

alter table public.member_channel_counts enable row level security;

-- Like message_counts: a hidden member's rows would still expose their user id.
create policy "public read" on public.member_channel_counts for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.guild_id = member_channel_counts.guild_id
            and m.user_id = member_channel_counts.user_id
            and not m.hidden
    )
);

-- Reactions a member added, per emoji and UTC day.
create table if not exists public.member_emoji_counts (
    guild_id text not null,
    user_id text not null,
    emoji_key text not null,
    day date not null,  -- UTC day
    count integer not null check (count >= 0),
    primary key (guild_id, user_id, emoji_key, day),
    foreign key (guild_id, user_id) references public.members (guild_id, user_id),
    foreign key (guild_id, emoji_key) references public.emojis (guild_id, emoji_key)
);

alter table public.member_emoji_counts enable row level security;

create policy "public read" on public.member_emoji_counts for select to anon, authenticated using (
    exists (
        select from public.members m
        where m.guild_id = member_emoji_counts.guild_id
            and m.user_id = member_emoji_counts.user_id
            and not m.hidden
    )
);

-- Dropped and recreated: a new parameter is a new signature. Same bodies plus one insert.

drop function if exists public.increment_activity(uuid, jsonb, jsonb, text);
create function public.increment_activity(
    batch uuid, counts jsonb, channel_counts jsonb, guild text, member_channel_counts jsonb default '[]'
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

    insert into public.message_counts (guild_id, user_id, day, count)
    select guild, c.user_id, c.day, c.count
    from jsonb_to_recordset(counts) as c(user_id text, day date, count integer)
    on conflict (guild_id, user_id, day)
    do update set count = public.message_counts.count + excluded.count;

    insert into public.channel_message_counts (guild_id, channel_id, hour, count)
    select guild, c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (guild_id, channel_id, hour)
    do update set count = public.channel_message_counts.count + excluded.count;

    insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
    select guild, c.user_id, c.channel_id, c.day, c.count
    from jsonb_to_recordset(member_channel_counts) as c(user_id text, channel_id text, day date, count integer)
    on conflict (guild_id, user_id, channel_id, day)
    do update set count = public.member_channel_counts.count + excluded.count;
end;
$$;

revoke execute on function public.increment_activity(uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.increment_activity(uuid, jsonb, jsonb, text, jsonb) to service_role;

drop function if exists public.backfill_page(text, text, text, text, boolean, jsonb, jsonb);
create function public.backfill_page(
    guild text,
    channel text,
    before text,
    next_before text,
    finished boolean,
    counts jsonb,
    channel_counts jsonb,
    member_channel_counts jsonb default '[]'
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
    on conflict (guild_id, user_id, day)
    do update set count = public.message_counts.count + excluded.count;

    insert into public.channel_message_counts (guild_id, channel_id, hour, count)
    select guild, c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (guild_id, channel_id, hour)
    do update set count = public.channel_message_counts.count + excluded.count;

    insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
    select guild, c.user_id, c.channel_id, c.day, c.count
    from jsonb_to_recordset(member_channel_counts) as c(user_id text, channel_id text, day date, count integer)
    on conflict (guild_id, user_id, channel_id, day)
    do update set count = public.member_channel_counts.count + excluded.count;

    return true;
end;
$$;

revoke execute on function public.backfill_page(text, text, text, text, boolean, jsonb, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.backfill_page(text, text, text, text, boolean, jsonb, jsonb, jsonb) to service_role;

drop function if exists public.increment_reactions(uuid, jsonb, jsonb, jsonb, text);
create function public.increment_reactions(
    batch uuid, emojis jsonb, emoji_counts jsonb, received_counts jsonb, guild text,
    member_emoji_counts jsonb default '[]'
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

    insert into public.emojis (guild_id, emoji_key, emoji_id, name, animated)
    select guild, e.emoji_key, e.emoji_id, e.name, coalesce(e.animated, false)
    from jsonb_to_recordset(emojis) as e(emoji_key text, emoji_id text, name text, animated boolean)
    on conflict (guild_id, emoji_key)
    -- A missing name must not wipe out the one already known.
    do update set
        name = coalesce(excluded.name, public.emojis.name),
        animated = excluded.animated,
        updated_at = now();

    insert into public.emoji_counts (guild_id, emoji_key, day, count)
    select guild, c.emoji_key, c.day, c.count
    from jsonb_to_recordset(emoji_counts) as c(emoji_key text, day date, count integer)
    on conflict (guild_id, emoji_key, day)
    do update set count = public.emoji_counts.count + excluded.count;

    insert into public.reactions_received (guild_id, user_id, day, count)
    select guild, c.user_id, c.day, c.count
    from jsonb_to_recordset(received_counts) as c(user_id text, day date, count integer)
    on conflict (guild_id, user_id, day)
    do update set count = public.reactions_received.count + excluded.count;

    insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count)
    select guild, c.user_id, c.emoji_key, c.day, c.count
    from jsonb_to_recordset(member_emoji_counts) as c(user_id text, emoji_key text, day date, count integer)
    on conflict (guild_id, user_id, emoji_key, day)
    do update set count = public.member_emoji_counts.count + excluded.count;
end;
$$;

revoke execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text, jsonb) to service_role;

-- One member's busiest channels, all time. `not m.hidden` on top of RLS, so a caller that
-- bypasses RLS still gets nothing for a hidden member.
create or replace function public.member_top_channels(guild text, member text, top integer default 10)
returns table (channel_id text, name text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select ch.channel_id, ch.name, sum(c.count)::bigint as message_count
    from public.member_channel_counts c
    join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
    join public.channels ch on ch.guild_id = c.guild_id and ch.channel_id = c.channel_id
    where c.guild_id = guild and c.user_id = member and not m.hidden
    group by ch.channel_id, ch.name
    order by message_count desc, ch.name
    limit top;
$$;

grant execute on function public.member_top_channels(text, text, integer) to anon, authenticated;

-- The emoji one member reacts with most, all time.
create or replace function public.member_top_emoji(guild text, member text, top integer default 10)
returns table (emoji_key text, emoji_id text, name text, animated boolean, reaction_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select e.emoji_key, e.emoji_id, e.name, e.animated, sum(c.count)::bigint as reaction_count
    from public.member_emoji_counts c
    join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
    join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
    where c.guild_id = guild and c.user_id = member and not m.hidden
    group by e.emoji_key, e.emoji_id, e.name, e.animated
    order by reaction_count desc, e.emoji_key
    limit top;
$$;

grant execute on function public.member_top_emoji(text, text, integer) to anon, authenticated;
