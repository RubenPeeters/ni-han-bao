-- Proves per-server data is readable only by members of that server (#45): anon reads zero
-- rows from every table with a guild_id, and a logged-in user reads rows of their own
-- servers only; then that /forget-me deletes and keeps out a user (#72). Needs a database,
-- so it is not part of `make check`. Run against a local Supabase or the dev project
-- (never production); everything is rolled back:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-rls.sql
begin;

-- Two servers; the test user is a member of the first only. Ids no real row can have.
do $$
declare g text;
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
        insert into public.backfill_state (guild_id, before_id) values (g, '1');
        insert into public.backfill_cursors (guild_id, channel_id, before_id) values (g, 'c', '1');
        insert into public.welcome_messages (guild_id, channel_id) values (g, 'c');
        insert into public.guild_settings (guild_id, report_channel_id) values (g, 'c');
        insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
        values (g, 'rls-user', 'c', '2026-01-01', 1);
        insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count)
        values (g, 'rls-user', 'e', '2026-01-01', 1);
    end loop;
    insert into public.guild_members (guild_id, user_id) values ('rls-mine', 'rls-user');
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
    if (select servers from public.public_totals('2026-01-01')) < 2 then
        raise exception 'anon cannot read public_totals()';
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
    if (select count(*) from public.my_guilds()) <> 1 then raise exception 'my_guilds() is not just mine'; end if;
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
    insert into public.members (guild_id, user_id, display_name) values ('rls-mine', 'rls-user', 'x');
    if exists (select from public.members where user_id = 'rls-user') then
        raise exception 'a forgotten user is written again';
    end if;
    perform public.remember_user('rls-user');
    insert into public.members (guild_id, user_id, display_name) values ('rls-mine', 'rls-user', 'x');
    if not exists (select from public.members where user_id = 'rls-user') then
        raise exception 'remember_user() does not let the user back in';
    end if;
end $$;

\echo 'check-rls: ok'
rollback;
