-- Proves per-server data is readable only by members of that server (#45): anon reads zero
-- rows from every table with a guild_id, and a logged-in user reads rows of their own
-- servers only; that profiles follow their visibility (#100); then that /forget-me deletes
-- and keeps out a user (#72). Needs a database,
-- so it is not part of `make check`. Run against a local Supabase or the dev project
-- (never production); everything is rolled back:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-rls.sql
begin;

-- Two servers; the test user is a member of the first only. Ids no real row can have.
do $$
declare g text; s bigint; e bigint;
begin
    insert into auth.users (id) values ('00000000-0000-4000-8000-000000000045');
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values ('rls-user', '00000000-0000-4000-8000-000000000045', '{"sub":"rls-user"}', 'discord');
    foreach g in array array['rls-mine', 'rls-other'] loop
        insert into public.guilds (guild_id, name) values (g, g);
        insert into public.guild_members (guild_id, user_id) values (g, 'rls-' || g);
        insert into public.bot_status (guild_id, guild_name, member_count) values (g, g, 1);
        insert into public.members (guild_id, user_id, display_name) values (g, 'rls-user', 'x');
        insert into public.message_counts (guild_id, user_id, day, count) values (g, 'rls-user', '2026-01-01', 1);
        insert into public.channels (guild_id, channel_id, name) values (g, 'c', 'c');
        insert into public.channel_message_counts (guild_id, channel_id, hour, count)
        values (g, 'c', '2026-01-01T00:00:00Z', 1);
        insert into public.emojis (guild_id, emoji_key, name) values (g, 'e', 'e');
        insert into public.emoji_counts (guild_id, emoji_key, day, count) values (g, 'e', '2026-01-01', 1);
        insert into public.reactions_received (guild_id, user_id, day, count) values (g, 'rls-user', '2026-01-01', 1);
        insert into public.member_count_snapshots (guild_id, day, member_count) values (g, '2026-01-01', 1);
        insert into public.member_flow (guild_id, day, joins, leaves) values (g, '2026-01-01', 1, 0);
        insert into public.voice_seconds (guild_id, user_id, day, seconds) values (g, 'rls-user', '2026-01-01', 60);
        insert into public.report_cards (guild_id, week) values (g, '2025-12-29');
        insert into public.monthly_recaps (guild_id, month) values (g, '2025-12-01');
        insert into public.backfill_state (guild_id, before_id) values (g, '1');
        insert into public.backfill_cursors (guild_id, channel_id, before_id) values (g, 'c', '1');
        insert into public.welcome_messages (guild_id, channel_id) values (g, 'c');
        insert into public.guild_settings (guild_id, report_channel_id) values (g, 'c');
        insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
        values (g, 'rls-user', 'c', '2026-01-01', 1);
        insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count)
        values (g, 'rls-user', 'e', '2026-01-01', 1);
        insert into public.stores (guild_id, name, city, added_by) values (g, 's', 'c', 'rls-user') returning id into s;
        insert into public.store_regulars (guild_id, store_id, user_id) values (g, s, 'rls-user');
        insert into public.events (guild_id, store_id, starts_at) values (g, s, now() + interval '1 day') returning id into e;
        insert into public.event_attendees (guild_id, event_id, user_id) values (g, e, 'rls-user');
    end loop;
    insert into public.guild_members (guild_id, user_id) values ('rls-mine', 'rls-user');
    -- A member who ran /hide-me: none of their regulars may show.
    insert into public.members (guild_id, user_id, display_name, hidden) values ('rls-mine', 'rls-hidden', 'x', true);
    insert into public.store_regulars (guild_id, store_id, user_id)
    select 'rls-mine', id, 'rls-hidden' from public.stores where guild_id = 'rls-mine';
    insert into public.event_attendees (guild_id, event_id, user_id)
    select 'rls-mine', id, 'rls-hidden' from public.events where guild_id = 'rls-mine';
    -- Profiles (#100): one per visibility. rls-rls-mine shares rls-mine with the test user,
    -- rls-public shares nothing with them.
    insert into public.members (guild_id, user_id, display_name) values ('rls-mine', 'rls-rls-mine', 'x');
    insert into public.members (guild_id, user_id, display_name) values ('rls-other', 'rls-rls-other', 'x');
    insert into public.members (guild_id, user_id, display_name) values ('rls-other', 'rls-public', 'x');
    insert into public.guild_members (guild_id, user_id) values ('rls-other', 'rls-public');
    insert into public.profiles (user_id, visibility)
    values ('rls-rls-mine', 'members'), ('rls-rls-other', 'members'), ('rls-public', 'public'), ('rls-hidden', 'public');
    -- Game time (#101): one row each, all playing now. rls-hidden is a member of rls-mine.
    insert into public.guild_members (guild_id, user_id) values ('rls-mine', 'rls-hidden');
    insert into public.activity_seconds (user_id, day, kind, name, seconds, live_at)
    select u, current_date, 'playing', 'Game', 3600, now()
    from unnest(array['rls-user', 'rls-rls-mine', 'rls-hidden', 'rls-public']) u;
    -- anon cannot read keys itself, so hand it one for the recap checks below.
    perform set_config('rls.other_key', (select key::text from public.monthly_recaps where guild_id = 'rls-other'), true);
end $$;

-- From pg_catalog, which every role can read, so a table anon has no grant on still counts.
create function pg_temp.guild_tables() returns setof text language sql as $$
    select c.relname::text
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'guild_id' and not a.attisdropped
$$;

set local role anon;
do $$
declare t text; n bigint;
begin
    for t in select pg_temp.guild_tables() loop
        execute format('select count(*) from public.%I', t) into n;
        if n <> 0 then raise exception 'anon reads % rows from %', n, t; end if;
    end loop;
    if exists (select from public.activity_seconds) then raise exception 'anon reads game time'; end if;
    if exists (select from public.profiles) or exists (select from public.profile('rls-public')) then
        raise exception 'anon reads a profile';
    end if;
    if (select servers from public.public_totals('2026-01-01')) < 2 then
        raise exception 'anon cannot read public_totals()';
    end if;
    -- Without the month's key (#75), anon gets no recap; with it, that month only.
    if public.monthly_recap('rls-mine', '2025-12-01') is not null then
        raise exception 'anon reads a recap without its key';
    end if;
    if public.monthly_recap('rls-mine', '2025-12-01',
        current_setting('rls.other_key')::uuid) is not null then
        raise exception 'anon reads a recap with another server''s key';
    end if;
    if public.monthly_recap('rls-other', '2025-12-01', current_setting('rls.other_key')::uuid) is null then
        raise exception 'anon cannot read a recap with its key';
    end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000045","role":"authenticated"}', true);
do $$
declare t text; mine bigint; other bigint;
begin
    for t in select pg_temp.guild_tables() loop
        execute format('select count(*) filter (where guild_id = ''rls-mine''),'
            ' count(*) filter (where guild_id <> ''rls-mine'') from public.%I', t) into mine, other;
        if mine = 0 then raise exception 'a member reads no rows of their own server from %', t; end if;
        if other <> 0 then raise exception 'a member reads % rows of other servers from %', other, t; end if;
    end loop;
    if exists (select from public.store_regulars where user_id = 'rls-hidden') then
        raise exception 'a member reads the regulars of a hidden member';
    end if;
    if (select sum(regulars) from public.store_regular_counts('rls-mine')) <> 1 then
        raise exception 'store_regular_counts() does not count just the visible regular';
    end if;
    if exists (select from public.event_attendees where user_id = 'rls-hidden') then
        raise exception 'a member reads the attendance of a hidden member';
    end if;
    if (select going from public.upcoming_events('rls-mine')) <> array['x'] then
        raise exception 'upcoming_events() does not list just the visible goer';
    end if;
    if exists (select from public.upcoming_events('rls-other')) then
        raise exception 'a member reads another server''s events';
    end if;
    -- Profiles (#100): visibility and shared servers, checked in the database.
    if not exists (select from public.profile('rls-rls-mine')) then
        raise exception 'a member cannot see the profile of someone they share a server with';
    end if;
    if exists (select from public.profile('rls-rls-other')) or exists (select from public.profiles where user_id = 'rls-rls-other') then
        raise exception 'a member sees a members-only profile without a shared server';
    end if;
    if exists (select from public.profile('rls-hidden')) or exists (select from public.profiles where user_id = 'rls-hidden') then
        raise exception 'a member sees the profile of a hidden member';
    end if;
    if not exists (select from public.profile('rls-public')) or exists (select from public.profile_servers('rls-public')) then
        raise exception 'a public profile does not show, or shows servers the visitor is not in';
    end if;
    if (select visibility from public.profile('rls-user')) <> 'private' then
        raise exception 'your own profile is not there, or not private by default';
    end if;
    if (select array_agg(guild_id) from public.profile_servers('rls-user')) <> array['rls-mine'] then
        raise exception 'profile_servers() is not just the shared servers';
    end if;
    if (select longest_streak from public.profile_badges('rls-user')) <> 1 then
        raise exception 'profile_badges() does not count the streak';
    end if;
    if not exists (select from public.profile_badges('rls-rls-mine')) then
        raise exception 'profile_badges() is empty for a members profile in a shared server';
    end if;
    if exists (select from public.profile_badges('rls-public')) then
        raise exception 'profile_badges() covers servers the visitor is not in';
    end if;
    begin
        perform public.set_profile_visibility('everyone');
        raise exception 'set_profile_visibility() accepts a value that is not a visibility';
    exception when check_violation then null;
    end;
    perform public.set_profile_visibility('public');
    if (select visibility from public.profiles where user_id = 'rls-user') <> 'public' then
        raise exception 'set_profile_visibility() does not save your own setting';
    end if;
    -- Game time (#101): read through functions only, per shared server, hidden members left out.
    if exists (select from public.activity_seconds) then raise exception 'a member reads game time directly'; end if;
    if (select players from public.guild_games('rls-mine', current_date)) <> 2 then
        raise exception 'guild_games() does not count just the visible members';
    end if;
    if exists (select from public.guild_games('rls-other', current_date))
        or exists (select from public.guild_playing_now('rls-other')) then
        raise exception 'a member reads another server''s games';
    end if;
    if (select players from public.guild_playing_now('rls-mine')) <> array['x']
        or (select others from public.guild_playing_now('rls-mine')) <> 1 then
        raise exception 'guild_playing_now() names a private profile or a hidden member';
    end if;
    if not exists (select from public.profile_games('rls-rls-mine')) or exists (select from public.profile_games('rls-public'))
        or exists (select from public.profile_games('rls-hidden')) then
        raise exception 'profile_games() does not follow the profile and shared servers';
    end if;
    if (select count(*) from public.my_guilds()) <> 1 then raise exception 'my_guilds() is not just mine'; end if;
    if public.monthly_recap('rls-mine', '2025-12-01') is null then raise exception 'a member cannot read their recap'; end if;
    if public.monthly_recap('rls-other', '2025-12-01') is not null then raise exception 'a member reads another server''s recap'; end if;
end $$;

-- Your own profile still shows your stats in a server where you ran /hide-me (#100).
reset role;
update public.members set hidden = true where guild_id = 'rls-mine' and user_id = 'rls-user';
set local role authenticated;
do $$
begin
    if (select message_count from public.profile_servers('rls-user')) <> 1
        or (select voice_seconds from public.profile_servers('rls-user')) <> 60 then
        raise exception 'profile_servers() drops your own counts where you are hidden';
    end if;
    if (select longest_streak from public.profile_badges('rls-user')) <> 1
        or (select channel_name from public.profile_badges('rls-user')) is null then
        raise exception 'profile_badges() drops your own badges where you are hidden';
    end if;
end $$;

-- /forget-me (#72): no row about the user is left anywhere, and none can be written again
-- until remember_user().
reset role;
do $$
declare t text; n bigint;
begin
    perform public.forget_user('rls-user');
    for t in
        select c.relname::text from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'public' and c.relkind = 'r' and a.attname = 'user_id' and not a.attisdropped
    loop
        execute format('select count(*) from public.%I where user_id = ''rls-user''', t) into n;
        if n <> 0 then raise exception 'forget_user() leaves % rows in %', n, t; end if;
    end loop;
    if exists (select from public.stores where added_by = 'rls-user') then
        raise exception 'forget_user() leaves the user on the stores they added';
    end if;
    insert into public.members (guild_id, user_id, display_name) values ('rls-mine', 'rls-user', 'x');
    if exists (select from public.members where user_id = 'rls-user') then
        raise exception 'a forgotten user is written again';
    end if;
    begin
        perform public.set_profile_visibility('members');
        raise exception 'set_profile_visibility() reports a save for a forgotten user';
    exception when raise_exception then
        if sqlerrm not like '%/show-me%' then raise; end if;
    end;
    perform public.remember_user('rls-user');
    insert into public.members (guild_id, user_id, display_name) values ('rls-mine', 'rls-user', 'x');
    if not exists (select from public.members where user_id = 'rls-user') then
        raise exception 'remember_user() does not let the user back in';
    end if;
end $$;

\echo 'check-rls: ok'
rollback;
