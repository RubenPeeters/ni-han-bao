-- Multi-server, part 3: the bot counts every server it is in. The guild_id-leading unique
-- indexes from part 1 become the primary keys, the single-server keys go, and so does the
-- guild_id default: a row must name its server. Not backwards compatible, allowed by #43.
-- The bot on main keeps working until this release reaches it: it already sends guild_id
-- everywhere, its plain upserts conflict on the primary key (now the composite one) and the
-- functions it calls are replaced below with the new conflict targets.

-- Foreign keys on the old single-column keys go first, or those keys cannot be dropped.
alter table public.message_counts drop constraint if exists message_counts_user_id_fkey;
alter table public.reactions_received drop constraint if exists reactions_received_user_id_fkey;
alter table public.voice_seconds drop constraint if exists voice_seconds_user_id_fkey;
alter table public.channel_message_counts drop constraint if exists channel_message_counts_channel_id_fkey;
alter table public.emoji_counts drop constraint if exists emoji_counts_emoji_key_fkey;

alter table public.members drop constraint members_pkey;
alter table public.members add constraint members_pkey primary key using index members_guild_user;
alter table public.message_counts drop constraint message_counts_pkey;
alter table public.message_counts add constraint message_counts_pkey primary key using index message_counts_guild_user_day;
alter table public.channels drop constraint channels_pkey;
alter table public.channels add constraint channels_pkey primary key using index channels_guild_channel;
alter table public.channel_message_counts drop constraint channel_message_counts_pkey;
alter table public.channel_message_counts
    add constraint channel_message_counts_pkey primary key using index channel_message_counts_guild_channel_hour;
alter table public.emojis drop constraint emojis_pkey;
alter table public.emojis add constraint emojis_pkey primary key using index emojis_guild_emoji;
alter table public.emoji_counts drop constraint emoji_counts_pkey;
alter table public.emoji_counts add constraint emoji_counts_pkey primary key using index emoji_counts_guild_emoji_day;
alter table public.reactions_received drop constraint reactions_received_pkey;
alter table public.reactions_received
    add constraint reactions_received_pkey primary key using index reactions_received_guild_user_day;
alter table public.member_count_snapshots drop constraint member_count_snapshots_pkey;
alter table public.member_count_snapshots
    add constraint member_count_snapshots_pkey primary key using index member_count_snapshots_guild_day;
alter table public.member_flow drop constraint member_flow_pkey;
alter table public.member_flow add constraint member_flow_pkey primary key using index member_flow_guild_day;
alter table public.voice_seconds drop constraint voice_seconds_pkey;
alter table public.voice_seconds add constraint voice_seconds_pkey primary key using index voice_seconds_guild_user_day;
alter table public.report_cards drop constraint report_cards_pkey;
alter table public.report_cards add constraint report_cards_pkey primary key using index report_cards_guild_week;

-- One row per server now. `id` stays (unconstrained, default 1) because the bot on main still
-- sends it; drop it in a later release.
alter table public.bot_status drop constraint bot_status_pkey;
alter table public.bot_status drop constraint if exists bot_status_id_check;
alter table public.bot_status add constraint bot_status_pkey primary key using index bot_status_guild;

-- Not valid: the old keys could not keep servers apart, so a local run against another server
-- may have left rows these would reject, and a failed migration blocks every deploy. They are
-- enforced for every new row all the same.
alter table public.message_counts add constraint message_counts_member_fkey
    foreign key (guild_id, user_id) references public.members (guild_id, user_id) not valid;
alter table public.reactions_received add constraint reactions_received_member_fkey
    foreign key (guild_id, user_id) references public.members (guild_id, user_id) not valid;
alter table public.voice_seconds add constraint voice_seconds_member_fkey
    foreign key (guild_id, user_id) references public.members (guild_id, user_id) not valid;
alter table public.channel_message_counts add constraint channel_message_counts_channel_fkey
    foreign key (guild_id, channel_id) references public.channels (guild_id, channel_id) not valid;
alter table public.emoji_counts add constraint emoji_counts_emoji_fkey
    foreign key (guild_id, emoji_key) references public.emojis (guild_id, emoji_key) not valid;

alter table public.members alter column guild_id drop default;
alter table public.message_counts alter column guild_id drop default;
alter table public.channels alter column guild_id drop default;
alter table public.channel_message_counts alter column guild_id drop default;
alter table public.emojis alter column guild_id drop default;
alter table public.emoji_counts alter column guild_id drop default;
alter table public.reactions_received alter column guild_id drop default;
alter table public.member_count_snapshots alter column guild_id drop default;
alter table public.member_flow alter column guild_id drop default;
alter table public.voice_seconds alter column guild_id drop default;
alter table public.report_cards alter column guild_id drop default;

-- The write functions lose their guild default too (a missing guild must fail, not land in
-- The Think Tank) and conflict on the new keys. Dropped and recreated: create or replace
-- cannot remove a default. Callers pass arguments by name, and the bot on main passes guild.

drop function if exists public.increment_activity(uuid, jsonb, jsonb, text);
create function public.increment_activity(batch uuid, counts jsonb, channel_counts jsonb, guild text)
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
end;
$$;

revoke execute on function public.increment_activity(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_activity(uuid, jsonb, jsonb, text) to service_role;

drop function if exists public.increment_reactions(uuid, jsonb, jsonb, jsonb, text);
create function public.increment_reactions(
    batch uuid, emojis jsonb, emoji_counts jsonb, received_counts jsonb, guild text
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
end;
$$;

revoke execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_reactions(uuid, jsonb, jsonb, jsonb, text) to service_role;

drop function if exists public.increment_timeline(uuid, jsonb, jsonb, text);
create function public.increment_timeline(batch uuid, flow jsonb, voice jsonb, guild text)
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

    insert into public.member_flow (guild_id, day, joins, leaves)
    select guild, f.day, f.joins, f.leaves
    from jsonb_to_recordset(flow) as f(day date, joins integer, leaves integer)
    on conflict (guild_id, day)
    do update set
        joins = public.member_flow.joins + excluded.joins,
        leaves = public.member_flow.leaves + excluded.leaves;

    -- least(): a day has only 86400 seconds; anything beyond is a clock glitch, not time
    -- spent, and must not make the whole batch fail its check forever.
    insert into public.voice_seconds (guild_id, user_id, day, seconds)
    select guild, v.user_id, v.day, least(v.seconds, 86400)
    from jsonb_to_recordset(voice) as v(user_id text, day date, seconds integer)
    on conflict (guild_id, user_id, day)
    do update set seconds = least(public.voice_seconds.seconds + excluded.seconds, 86400);
end;
$$;

revoke execute on function public.increment_timeline(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.increment_timeline(uuid, jsonb, jsonb, text) to service_role;

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
    on conflict (guild_id, user_id, day)
    do update set count = public.message_counts.count + excluded.count;

    insert into public.channel_message_counts (guild_id, channel_id, hour, count)
    select guild, c.channel_id, c.hour, c.count
    from jsonb_to_recordset(channel_counts) as c(channel_id text, hour timestamptz, count integer)
    on conflict (guild_id, channel_id, hour)
    do update set count = public.channel_message_counts.count + excluded.count;

    return true;
end;
$$;
