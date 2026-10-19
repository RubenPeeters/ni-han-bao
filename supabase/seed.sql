-- Demo server for screenshots (dev database only; never applied to production).
-- `migrate.yml` runs it on the dev project with `db push --include-seed`, and `supabase db reset`
-- runs it locally. Every page under /s/[guildId] and /u/[userId] needs a server the viewer is a
-- member of, so `make screenshots` signs in as the screenshot user below and photographs the
-- demo server (ids in scripts/screenshots.mjs).
--
-- Fake people and numbers only. The values are deterministic (hashtext of the row's key), but
-- the dates follow today: private.seed_demo() rebuilds everything, and pg_cron reruns it
-- nightly so the "last 7 days" style pages never go empty.
--
-- A page that reads a new table shows nothing until that table gets demo rows here; add them
-- in the same PR as the table.

create schema if not exists private;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.seed_demo()
returns void
language plpgsql
set search_path = ''
as $$
declare
    g constant text := '900000000000000001';
    viewer constant uuid := '00000000-0000-4000-8000-000000000101';
    names constant text[] := array['Anna', 'Bram', 'Chloé', 'Daan', 'Elise', 'Finn',
                                   'Hana', 'Jonas', 'Lotte', 'Milan', 'Noor', 'Sven'];
    users text[] := array(select '9000000000000001' || lpad(i::text, 2, '0') from generate_series(1, 12) i);
    today constant date := current_date;
begin
    -- Start clean: every table that holds demo-server or demo-user rows.
    delete from public.event_attendees where guild_id = g;
    delete from public.events where guild_id = g;
    delete from public.store_regulars where guild_id = g;
    delete from public.stores where guild_id = g;
    delete from public.monthly_recaps where guild_id = g;
    delete from public.guild_settings where guild_id = g;
    delete from public.member_emoji_counts where guild_id = g;
    delete from public.member_channel_counts where guild_id = g;
    delete from public.emoji_counts where guild_id = g;
    delete from public.emojis where guild_id = g;
    delete from public.channel_message_counts where guild_id = g;
    delete from public.channels where guild_id = g;
    delete from public.reactions_received where guild_id = g;
    delete from public.voice_seconds where guild_id = g;
    delete from public.message_counts where guild_id = g;
    delete from public.member_count_snapshots where guild_id = g;
    delete from public.member_flow where guild_id = g;
    delete from public.lol_matches where user_id = any (users);
    delete from public.lol_ranks where user_id = any (users);
    delete from public.game_accounts where user_id = any (users);
    delete from public.activity_seconds where user_id = any (users);
    delete from public.profiles where user_id = any (users);
    delete from public.guild_members where guild_id = g;
    delete from public.members where guild_id = g;
    delete from public.guilds where guild_id = g;

    insert into public.guilds (guild_id, name, icon_url)
        values (g, 'Demo server', 'https://cdn.discordapp.com/embed/avatars/1.png');
    insert into public.guild_settings (guild_id, timezone, public_totals_opt_out)
        values (g, 'Europe/Brussels', true);

    -- Discord's default avatars, so screenshots show pictures where real members have them.
    insert into public.members (guild_id, user_id, display_name, avatar_url)
        select g, users[i], names[i], 'https://cdn.discordapp.com/embed/avatars/' || (i - 1) % 6 || '.png'
        from generate_series(1, 12) i;
    insert into public.guild_members (guild_id, user_id) select g, u from unnest(users) u;
    -- Anna (the viewer) shares with members; a few are public, the rest stay private.
    insert into public.profiles (user_id, visibility)
        select users[i], case when i in (1, 2, 5) then 'members' when i in (3, 8) then 'public' else 'private' end
        from generate_series(1, 12) i;

    -- Activity over the last 120 days. Members differ in level (i) and every day is noisy.
    insert into public.message_counts (guild_id, user_id, day, count)
        select g, users[i], d::date, (abs(hashtext(users[i] || d::text)) % (90 - i * 6))
        from generate_series(1, 12) i, generate_series(today - 119, today, '1 day') d
        where abs(hashtext('m' || users[i] || d::text)) % 4 <> 0;
    insert into public.voice_seconds (guild_id, user_id, day, seconds)
        select g, users[i], d::date, (abs(hashtext('v' || users[i] || d::text)) % 4) * 1800
        from generate_series(1, 12) i, generate_series(today - 119, today, '1 day') d
        where i % 3 <> 0;
    insert into public.reactions_received (guild_id, user_id, day, count)
        select g, users[i], d::date, abs(hashtext('r' || users[i] || d::text)) % 12
        from generate_series(1, 12) i, generate_series(today - 119, today, '1 day') d;

    insert into public.member_count_snapshots (guild_id, day, member_count)
        select g, d::date, 40 + (d::date - (today - 119)) / 6
        from generate_series(today - 119, today, '1 day') d;
    insert into public.member_flow (guild_id, day, joins, leaves)
        select g, d::date, abs(hashtext('j' || d::text)) % 3, (abs(hashtext('l' || d::text)) % 5) / 4
        from generate_series(today - 119, today, '1 day') d;

    insert into public.channels (guild_id, channel_id, name) values
        (g, '900000000000000201', 'general'), (g, '900000000000000202', 'riftbound'),
        (g, '900000000000000203', 'league'), (g, '900000000000000204', 'trades'),
        (g, '900000000000000205', 'memes'), (g, '900000000000000206', 'events');
    -- Busy evenings, quiet nights: the heatmap needs a shape.
    insert into public.channel_message_counts (guild_id, channel_id, hour, count)
        select g, c.channel_id, h,
               (abs(hashtext(c.channel_id || h::text)) % 6)
               * case when extract(hour from h) between 17 and 22 then 4
                      when extract(hour from h) between 1 and 7 then 0 else 1 end
        from public.channels c, generate_series(date_trunc('hour', now()) - interval '60 days',
                                                date_trunc('hour', now()), '1 hour') h
        where c.guild_id = g;
    insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
        select g, users[i], c.channel_id, d::date, abs(hashtext(users[i] || c.channel_id || d::text)) % 15
        from generate_series(1, 12) i, public.channels c, generate_series(today - 59, today, '1 day') d
        where c.guild_id = g and abs(hashtext('mc' || users[i] || c.channel_id || d::text)) % 3 = 0;

    insert into public.emojis (guild_id, emoji_key, name)
        select g, e, e from unnest(array['😂', '🔥', '👍', '❤️', '🎉', '👀']) e;
    insert into public.emoji_counts (guild_id, emoji_key, day, count)
        select g, e, d::date, abs(hashtext(e || d::text)) % 20
        from unnest(array['😂', '🔥', '👍', '❤️', '🎉', '👀']) e, generate_series(today - 119, today, '1 day') d;
    insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count)
        select g, users[i], e, d::date, 1 + abs(hashtext(users[i] || e || d::text)) % 4
        from generate_series(1, 12) i, unnest(array['😂', '🔥', '👍', '❤️', '🎉', '👀']) e,
             generate_series(today - 59, today, '1 day') d
        where abs(hashtext('me' || users[i] || e || d::text)) % 5 = 0;

    -- Games and streams (presence), last 60 days.
    insert into public.activity_seconds (user_id, day, kind, name, seconds)
        select users[i], d::date, 'playing', game, (1 + abs(hashtext(users[i] || game || d::text)) % 6) * 1800
        from generate_series(1, 12) i, generate_series(today - 59, today, '1 day') d,
             unnest(array['League of Legends', 'Riftbound', 'Teamfight Tactics', 'Valorant']) game
        where abs(hashtext('a' || users[i] || game || d::text)) % 4 = 0;
    insert into public.activity_seconds (user_id, day, kind, name, seconds)
        select users[i], d::date, 'streaming', 'League of Legends', 3600 * (1 + abs(hashtext('s' || d::text)) % 3)
        from generate_series(2, 3) i, generate_series(today - 59, today, '1 day') d
        where abs(hashtext('st' || users[i] || d::text)) % 5 = 0;

    -- League: eight members linked, one per tier band, both queues for some.
    insert into public.game_accounts (user_id, game, external_id, region)
        select users[i], 'lol', 'demo-puuid-' || i, 'euw1' from generate_series(1, 8) i;
    insert into public.lol_ranks (user_id, queue, tier, division, lp) values
        (users[1], 'RANKED_SOLO_5x5', 'EMERALD', 'II', 54), (users[1], 'RANKED_FLEX_SR', 'PLATINUM', 'I', 12),
        (users[2], 'RANKED_SOLO_5x5', 'DIAMOND', 'IV', 31),
        (users[3], 'RANKED_SOLO_5x5', 'GOLD', 'III', 77), (users[3], 'RANKED_FLEX_SR', 'GOLD', 'I', 90),
        (users[4], 'RANKED_SOLO_5x5', 'SILVER', 'I', 3),
        (users[5], 'RANKED_SOLO_5x5', 'MASTER', null, 142),
        (users[6], 'RANKED_SOLO_5x5', 'PLATINUM', 'IV', 66), (users[6], 'RANKED_FLEX_SR', 'EMERALD', 'IV', 20),
        (users[7], 'RANKED_SOLO_5x5', 'BRONZE', 'II', 48),
        (users[8], 'RANKED_FLEX_SR', 'IRON', 'I', 99);
    -- Their games of the last two weeks (the weekly report counts the last 7 days).
    insert into public.lol_matches (user_id, puuid, match_id, queue_id, champion, played_at)
        select users[i], 'demo-puuid-' || i, 'EUW1_DEMO_' || i || '_' || n,
               case when n % 3 = 0 then 440 else 420 end,
               (array['Ahri', 'Jinx', 'Lee Sin', 'Thresh', 'Garen', 'Lux'])[1 + abs(hashtext(users[i] || n::text)) % (2 + i % 4)],
               now() - (n * interval '7 hours') - (i * interval '13 minutes')
        from generate_series(1, 8) i, generate_series(1, 48) n
        where abs(hashtext('lm' || users[i] || n::text)) % (1 + i % 3) = 0;

    -- Riftbound local play: stores, regulars and upcoming events.
    insert into public.stores (guild_id, name, city, url, added_by) values
        (g, 'The Card Corner', 'Leuven', 'https://example.com/card-corner', users[1]),
        (g, 'Dragon''s Den Games', 'Brussels', null, users[2]),
        (g, 'Meeple Market', 'Ghent', 'https://example.com/meeple-market', users[4]);
    insert into public.store_regulars (guild_id, store_id, user_id)
        select g, s.id, users[i] from public.stores s, generate_series(1, 12) i
        where s.guild_id = g and abs(hashtext(s.name || users[i])) % 3 = 0;
    insert into public.events (guild_id, store_id, name, starts_at)
        select g, s.id, e.name, date_trunc('day', now()) + e.offs
        from (values ('The Card Corner', 'Riftbound Nexus Night', interval '3 days 19 hours'),
                     ('Dragon''s Den Games', 'Riftbound Summoner Skirmish', interval '9 days 13 hours'),
                     ('Meeple Market', 'Riftbound casual play', interval '16 days 18 hours')) e (store, name, offs)
        join public.stores s on s.guild_id = g and s.name = e.store;
    insert into public.event_attendees (guild_id, event_id, user_id)
        select g, ev.id, users[i] from public.events ev, generate_series(1, 12) i
        where ev.guild_id = g and abs(hashtext(ev.name || users[i])) % 3 <> 0;

    -- Last month's recap, as if the bot posted it.
    insert into public.monthly_recaps (guild_id, month, posted_at)
        values (g, date_trunc('month', today - interval '1 month')::date, date_trunc('month', now()));

    -- The screenshot login: email and password for `make screenshots`, plus a Discord identity
    -- so current_discord_id() maps it to Anna. The password is only on the forge box (forge.toml
    -- [repo.env] SCREENSHOT_PASSWORD); this is its bcrypt hash.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', viewer, 'authenticated', 'authenticated',
                'screenshots@ni-han-bao.invalid', '$2a$10$UD/avWhP2ZfIpLYAA.k9MeEanuaP80Q7JPlv0eDIzuH6GDRb8INf.', now(),
                '{"provider": "email", "providers": ["email", "discord"]}', '{"full_name": "Anna"}',
                now(), now(), '', '', '', '')
        on conflict (id) do update set encrypted_password = excluded.encrypted_password;
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
        values (viewer::text, viewer, jsonb_build_object('sub', viewer::text, 'email', 'screenshots@ni-han-bao.invalid',
                                                         'email_verified', true), 'email', now(), now()),
               (users[1], viewer, jsonb_build_object('sub', users[1], 'full_name', 'Anna'), 'discord', now(), now())
        on conflict (provider_id, provider) do nothing;
end;
$$;

revoke execute on function private.seed_demo() from public;

select private.seed_demo();
select cron.schedule('seed-demo', '17 3 * * *', 'select private.seed_demo()');
