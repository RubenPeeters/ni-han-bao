-- Proves per-server data is readable only by members of that server (#45): anon reads zero
-- rows from every table with a guild_id, and a logged-in user reads rows of their own
-- servers only; that profiles follow their visibility (#100); that the lending ledger holds
-- (#172); that decks follow their visibility (#173) and only public ones are remembered as
-- opened (#174), their versions with them (#176), and wishlists their profile (#177); that trade
-- matches follow it too (#178), and decks not for lending hold their cards (#179); that borrow requests
-- reach only lenders Who has it? shows (#299); that only public decks are teased logged
-- out (#175); then that /forget-me deletes
-- and keeps out a user (#72). Needs a database,
-- so it is not part of `make check`; migrate.yml runs it on the dev project after the seed.
-- Run against a local Supabase or the dev project (never production); everything is rolled back.
-- The dev project holds the demo seed, so every check is scoped to the script's own rls- rows:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-rls.sql
begin;
-- The session user may be a CLI login role (migrate.yml), so `reset role` alone is not postgres.
set role postgres;

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
    insert into public.message_counts (guild_id, user_id, day, count) values ('rls-mine', 'rls-hidden', '2026-01-01', 1);
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
    -- Game icons (#141): read through guild_games() only.
    insert into public.games (name, application_id, icon) values ('Game', '1', 'i');
    -- Linked game accounts (#102): the bot's only, read by nobody else.
    insert into public.game_accounts (user_id, game, external_id, region) values ('rls-user', 'lol', 'p', 'euw1');
    -- League ranks (#103): read through functions only, per profile and per server.
    insert into public.game_accounts (user_id, game, external_id, region)
    select u, 'lol', u, 'euw1' from unnest(array['rls-rls-mine', 'rls-rls-other', 'rls-hidden']) u;
    insert into public.lol_ranks (user_id, queue, tier, division, lp)
    select u, 'RANKED_SOLO_5x5', 'GOLD', 'II', 47 from unnest(array['rls-rls-mine', 'rls-rls-other', 'rls-hidden']) u;
    -- League rank history (#301): no policies, read by nobody but the bot.
    insert into public.lol_rank_changes (user_id, puuid, queue, tier, division, lp)
    select u, u, 'RANKED_SOLO_5x5', 'GOLD', 'II', 47 from unnest(array['rls-rls-mine', 'rls-rls-other', 'rls-hidden']) u;
    -- League games (#104): read through functions only, per server. An hour ago: now() does not
    -- move inside a transaction, and lol_week() counts played_at < now().
    insert into public.lol_matches (user_id, puuid, match_id, queue_id, champion, played_at)
    select u, u, 'EUW1_' || u, 420, 'Ahri', now() - interval '1 hour' from unnest(array['rls-rls-mine', 'rls-rls-other', 'rls-hidden']) u;
    -- The Riftbound catalogue (#148): global, for anyone logged in.
    insert into public.riftbound_cards (id, name, type) values ('rls-card', 'x', 'Spell');
    insert into public.riftbound_printings (id, card_id, set_code, collector_code, collector_number)
    values ('rls-printing', 'rls-card', 'RLS', 'RLS-001/001', 1),
        -- An alternate art (#284): no playset ever fills it.
        ('rls-alt', 'rls-card', 'RLS', 'RLS-001a/001', 1);
    -- Collections (#150): rls-rls-mine lends everything, rls-hidden lends but is hidden,
    -- rls-rls-other lends but shares no server; rls-user owns one but does not lend.
    update public.profiles set lends_cards = true, lend_all = true where user_id in ('rls-rls-mine', 'rls-hidden', 'rls-rls-other');
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, quantity)
    select u, 'rls-printing', 'normal', 'NM', 2 from unnest(array['rls-user', 'rls-rls-mine', 'rls-hidden', 'rls-rls-other']) u;
    -- Loans (#172): rls-rls-mine lent the test user one copy; rls-rls-other lent rls-public one.
    perform public.lend_riftbound_cards(l, b, null, null,
        '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"en","quantity":1}]')
    from (values ('rls-rls-mine', 'rls-user'), ('rls-rls-other', 'rls-public')) v (l, b);
    -- Decks (#173): rls-rls-mine shares a server with the test user, rls-rls-other does not.
    insert into public.riftbound_cards (id, name, type) values ('rls-card-2', 'y', 'Spell');
    insert into public.riftbound_decks (user_id, name, visibility)
    values ('rls-rls-mine', 'servers-shared', 'servers'), ('rls-rls-mine', 'private', 'private'),
           ('rls-rls-other', 'servers-not-shared', 'servers'), ('rls-public', 'public', 'public');
    insert into public.riftbound_deck_cards (deck_id, section, card_id, quantity)
    select id, 'main', 'rls-card', 1 from public.riftbound_decks where user_id like 'rls-%';
    perform public.snapshot_riftbound_deck(id) from public.riftbound_decks where user_id like 'rls-%';
    -- Wishlists (#177): rls-rls-mine's two shared decks need one rls-card each.
    update public.riftbound_decks set wishlist_mode = 'shared' where user_id = 'rls-rls-mine';
    insert into public.riftbound_wishlist (user_id, card_id, quantity)
    values ('rls-rls-mine', 'rls-card-2', 2), ('rls-rls-other', 'rls-card-2', 1), ('rls-hidden', 'rls-card-2', 1);
    -- Trades (#178): everyone but the test user has a copy of rls-card for trade.
    update public.riftbound_collection set for_trade = 1 where user_id <> 'rls-user';
    -- anon cannot read keys itself, so hand it one for the recap checks below.
    -- Nor deck ids, for the deck teaser checks (#175) below.
    perform set_config('rls.public_deck', (select id::text from public.riftbound_decks where name = 'public'), true);
    perform set_config('rls.servers_deck', (select id::text from public.riftbound_decks where name = 'servers-shared'), true);
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
    if exists (select from public.games) then raise exception 'anon reads game icons'; end if;
    if exists (select from public.riftbound_cards) or exists (select from public.riftbound_printings) then
        raise exception 'anon reads the card catalogue';
    end if;
    if exists (select from public.game_accounts) then raise exception 'anon reads linked accounts'; end if;
    if exists (select from public.riftbound_collection) or exists (select from public.profile_collection('rls-rls-mine')) then
        raise exception 'anon reads a collection';
    end if;
    if exists (select from public.riftbound_loans) or exists (select from public.riftbound_loan_cards)
        or exists (select from public.riftbound_loan_entries) then
        raise exception 'anon reads a loan';
    end if;
    if exists (select from public.riftbound_borrow_requests) or exists (select from public.riftbound_borrow_request_cards)
        or exists (select from public.riftbound_borrow_request_answers) or exists (select from public.riftbound_borrow_request_dms) then
        raise exception 'anon reads a borrow request';
    end if;
    if exists (select from public.riftbound_decks) or exists (select from public.riftbound_deck_cards) then
        raise exception 'anon reads a deck, even a public one';
    end if;
    if exists (select from public.riftbound_deck_opens) then raise exception 'anon reads an opened deck'; end if;
    -- Logged-out deck pages (#175): a teaser of a public deck, of no other.
    if not exists (select from public.public_deck_teaser(current_setting('rls.public_deck')::uuid))
        or exists (select from public.public_deck_teaser(current_setting('rls.servers_deck')::uuid)) then
        raise exception 'public_deck_teaser() misses a public deck or teases another';
    end if;
    if exists (select from public.riftbound_deck_versions) then raise exception 'anon reads a deck version'; end if;
    if exists (select from public.riftbound_wishlist) or exists (select from public.profile_wishlist('rls-rls-mine')) then
        raise exception 'anon reads a wishlist';
    end if;
    if exists (select from public.riftbound_trade_matches) then raise exception 'anon reads trade matches'; end if;
    if exists (select from public.lol_ranks) or exists (select from public.profile_ranks('rls-rls-mine')) then
        raise exception 'anon reads a rank';
    end if;
    if exists (select from public.lol_rank_changes) then raise exception 'anon reads rank history'; end if;
    if exists (select from public.lol_matches) or public.profile_lol_champion('rls-rls-mine') is not null then
        raise exception 'anon reads League games';
    end if;
    if exists (select from public.profiles) or exists (select from public.profile('rls-public')) then
        raise exception 'anon reads a profile';
    end if;
    if public.message_total('2026-01-01', 'rls-mine') <> 0 then raise exception 'anon reads a server''s message_total()'; end if;
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
declare t text; mine bigint; other bigint; deck uuid;
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
    -- Settings (#208): the visitor's own servers and linked accounts, nobody else's.
    if (select array_agg(guild_id || ':' || hidden) from public.my_server_visibility()) <> array['rls-mine:false'] then
        raise exception 'my_server_visibility() is not just the visitor''s servers';
    end if;
    if (select array_agg(game || ':' || region) from public.my_game_accounts()) <> array['lol:euw1'] then
        raise exception 'my_game_accounts() is not just the visitor''s accounts';
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
    -- Private again, so guild_playing_now() must count rls-user without naming them.
    perform public.set_profile_visibility('private');
    if exists (select from public.activity_seconds) then raise exception 'a member reads game time directly'; end if;
    if exists (select from public.game_accounts) then raise exception 'a member reads linked accounts'; end if;
    if exists (select from public.lol_ranks) then raise exception 'a member reads ranks directly'; end if;
    if exists (select from public.lol_rank_changes) then raise exception 'a member reads rank history directly'; end if;
    if exists (select from public.lol_matches) then raise exception 'a member reads League games directly'; end if;
    if (select array_agg(user_id || ':' || games order by user_id) from public.guild_lol_week('rls-mine'))
        <> array['rls-rls-mine:1', 'rls-user:0'] then
        raise exception 'guild_lol_week() does not list just the visible linked members';
    end if;
    if exists (select from public.guild_lol_week('rls-other')) then
        raise exception 'a member reads another server''s League games';
    end if;
    if (select array_agg(user_id) from public.guild_ranks('rls-mine', 'RANKED_SOLO_5x5')) <> array['rls-rls-mine'] then
        raise exception 'guild_ranks() does not list just the visible linked members';
    end if;
    if exists (select from public.guild_ranks('rls-other', 'RANKED_SOLO_5x5')) then
        raise exception 'a member reads another server''s ranks';
    end if;
    if not exists (select from public.profile_ranks('rls-rls-mine')) or exists (select from public.profile_ranks('rls-rls-other'))
        or exists (select from public.profile_ranks('rls-hidden')) then
        raise exception 'profile_ranks() does not follow the profile';
    end if;
    if public.profile_lol_champion('rls-rls-mine') is distinct from 'Ahri' or public.profile_lol_champion('rls-rls-other') is not null
        or public.profile_lol_champion('rls-hidden') is not null then
        raise exception 'profile_lol_champion() does not follow the profile';
    end if;
    if exists (select from public.games) then raise exception 'a member reads game icons directly'; end if;
    if not exists (select from public.riftbound_cards where id = 'rls-card')
        or not exists (select from public.riftbound_printings where id = 'rls-printing') then
        raise exception 'a logged-in user cannot read the card catalogue';
    end if;
    -- Collections (#150): your own rows directly, others' through the functions only.
    if (select array_agg(user_id) from public.riftbound_collection) <> array['rls-user'] then
        raise exception 'a member reads collection rows that are not theirs';
    end if;
    -- rls-rls-mine has 2 and lent 1 (#172): the lent copy is not on offer.
    if (select array_agg(user_id || ':' || copies) from public.card_lenders('rls-card')) <> array['rls-rls-mine:[{"copies": 1, "language": "en"}]'] then
        raise exception 'card_lenders() does not list just the visible lenders of the visitor''s servers, or offers lent copies';
    end if;
    -- Loans (#172): only the parties, through profile_loans().
    if exists (select from public.riftbound_loans) or exists (select from public.riftbound_loan_cards)
        or exists (select from public.riftbound_loan_entries) then
        raise exception 'a member reads the lending ledger directly';
    end if;
    if (select array_agg(other_id || ':' || lent || ':' || state) from public.profile_loans('rls-user')) <> array['rls-rls-mine:false:open']
        or (select count(*) from public.profile_loans('rls-rls-mine')) <> 1
        or exists (select from public.profile_loans('rls-public')) or exists (select from public.profile_loans('rls-rls-other')) then
        raise exception 'profile_loans() shows loans the visitor is not a party to';
    end if;
    -- Borrow requests (#299): only of a lender Who has it? shows, for copies they have to lend
    -- in the languages asked, one open per card; read by the parties through my_borrow_requests().
    begin
        perform public.ask_to_borrow('rls-rls-mine', '[{"card_id": "rls-card", "quantity": 1}]', '{fr}', null, null);
        raise exception 'a request asks for copies the lender does not have in those languages';
    exception when raise_exception then
        if sqlerrm like 'a request%' then raise; end if;
    end;
    begin
        perform public.ask_to_borrow('rls-hidden', '[{"card_id": "rls-card", "quantity": 1}]', '{en}', null, null);
        raise exception 'a hidden member can be asked to lend';
    exception when raise_exception then
        if sqlerrm like 'a hidden%' then raise; end if;
    end;
    -- rls-rls-mine has one copy to lend: two entries of one each are two.
    begin
        perform public.ask_to_borrow('rls-rls-mine', '[{"card_id": "rls-card", "quantity": 1}, {"card_id": "rls-card", "quantity": 1}]', '{en}', null, null);
        raise exception 'a request asks for more copies than the lender has, split over two entries';
    exception when raise_exception then
        if sqlerrm like 'a request%' then raise; end if;
    end;
    perform public.ask_to_borrow('rls-rls-mine', '[{"card_id": "rls-card", "quantity": 1}]', '{en}', null, 'please');
    begin
        perform public.ask_to_borrow('rls-rls-mine', '[{"card_id": "rls-card", "quantity": 1}]', '{en}', null, null);
        raise exception 'two open requests for one card';
    exception when raise_exception then
        if sqlerrm like 'two open%' then raise; end if;
    end;
    if exists (select from public.riftbound_borrow_requests) or exists (select from public.riftbound_borrow_request_cards) then
        raise exception 'a member reads borrow requests directly';
    end if;
    if (select array_agg(other_id || ':' || asked || ':' || state) from public.my_borrow_requests()) <> array['rls-rls-mine:true:open']
        or public.decline_my_borrow_request((select id from public.my_borrow_requests()), null) <> 'not_lender'
        or public.cancel_borrow_request((select id from public.my_borrow_requests())) <> 'ok'
        or public.cancel_borrow_request((select id from public.my_borrow_requests())) <> 'closed' then
        raise exception 'my_borrow_requests() or Cancel does not follow the parties';
    end if;
    if not exists (select from public.profile_collection('rls-rls-mine')) or exists (select from public.profile_collection('rls-rls-other'))
        or exists (select from public.profile_collection('rls-hidden')) then
        raise exception 'profile_collection() does not follow the profile';
    end if;
    perform public.set_riftbound_copies('rls-printing', 'normal', 'NM', 'en', 4, 9, null);
    if (select quantity || ':' || for_trade from public.riftbound_collection) <> '4:4' then
        raise exception 'set_riftbound_copies() does not save, or lets for trade exceed the copies';
    end if;
    if (select lendable from public.riftbound_collection) is not null then
        raise exception 'set_riftbound_copies() turns the lending default into an explicit count';
    end if;
    if public.own_riftbound_playset('RLS', 'en') <> 0 then raise exception 'own_riftbound_playset() tops up a full playset'; end if;
    -- Languages (#171): the same printing in French is a row of its own, and becomes the last-used one.
    perform public.set_riftbound_copies('rls-printing', 'normal', 'NM', 'fr', 1, 0, null);
    if (select string_agg(language || ':' || quantity, ',' order by language) from public.riftbound_collection) <> 'en:4,fr:1' then
        raise exception 'set_riftbound_copies() does not keep languages apart';
    end if;
    if (select card_language from public.profiles where user_id = 'rls-user') <> 'fr' then
        raise exception 'set_riftbound_copies() does not remember the language';
    end if;
    perform public.set_riftbound_copies('rls-printing', 'normal', 'NM', 'fr', 0, 0, null);
    perform public.set_riftbound_copies('rls-printing', 'normal', 'NM', 'en', 0, 0, null);
    if exists (select from public.riftbound_collection) then raise exception 'set_riftbound_copies() keeps a row at 0'; end if;
    -- Each call is its own statement: a read in the same statement sees the rows from before the call.
    if public.own_riftbound_playset('RLS', 'zh-Hans') <> 1 then
        raise exception 'own_riftbound_playset() does not fill the set''s basic printings to 3 in the language asked for';
    end if;
    if (select string_agg(printing_id || ':' || language || ':' || quantity, ',') from public.riftbound_collection)
        is distinct from 'rls-printing:zh-Hans:3' then
        raise exception 'own_riftbound_playset() does not fill the set''s basic printings to 3 in the language asked for';
    end if;
    if public.own_riftbound_playset('RLS', 'zh-Hans', 6) <> 1 then
        raise exception 'own_riftbound_playset() does not fill the set''s basic printings to 6 for two playsets';
    end if;
    if (select string_agg(printing_id || ':' || language || ':' || quantity, ',') from public.riftbound_collection)
        is distinct from 'rls-printing:zh-Hans:6' then
        raise exception 'own_riftbound_playset() does not fill the set''s basic printings to 6 for two playsets';
    end if;
    -- Back to the 3 copies the checks below were written for.
    perform public.set_riftbound_copies('rls-printing', 'normal', 'NM', 'zh-Hans', 3, 0, null);
    perform public.set_card_lending(true, false);
    if (select lends_cards from public.profiles where user_id = 'rls-user') is not true then
        raise exception 'set_card_lending() does not save your own setting';
    end if;
    perform public.set_borrow_languages(array['en', 'fr']);
    if (select borrow_languages::text[] from public.profiles where user_id = 'rls-user') is distinct from array['en', 'fr'] then
        raise exception 'set_borrow_languages() does not save your own setting';
    end if;
    begin
        perform public.set_borrow_languages('{}');
        raise exception 'set_borrow_languages() accepts no language';
    exception when raise_exception then
        if sqlerrm <> 'pick at least one language' then raise; end if;
    end;
    -- Decks (#173): public ones and those of members of the visitor's servers, never private.
    if (select array_agg(name order by name) from public.riftbound_decks where user_id like 'rls-%') <> array['public', 'servers-shared']
        or (select count(*) from public.riftbound_deck_cards where card_id = 'rls-card') <> 2 then
        raise exception 'a member reads decks that are private, or shared only with servers they are not in';
    end if;
    if (select count(*) from public.riftbound_deck_versions where entries @> '[{"card_id":"rls-card"}]') <> 2 then
        raise exception 'a member reads versions of a deck they cannot see';
    end if;
    begin
        perform public.snapshot_riftbound_deck((select id from public.riftbound_decks where name = 'public'));
        raise exception 'a member writes a version of someone else''s deck';
    exception when insufficient_privilege then null;
    end;
    deck := public.save_riftbound_deck(null, 'mine', null, null, null, null, null, null,
        '[{"section":"main","card_id":"rls-card","printing_id":"rls-printing","quantity":2},
          {"section":"main","card_id":"rls-card","printing_id":"rls-printing","quantity":1}]');
    if (select visibility || ':' || language || ':' || allow_other_languages from public.riftbound_decks where id = deck)
        <> 'private:en:true'
        or (select quantity from public.riftbound_deck_cards where deck_id = deck) <> 3 then
        raise exception 'save_riftbound_deck() does not default to private and English, or does not merge entries';
    end if;
    perform public.add_riftbound_deck_card(deck, 'rls-card');
    if (select string_agg(coalesce(printing_id, '-') || ':' || quantity, ',' order by printing_id) from public.riftbound_deck_cards
        where deck_id = deck) <> 'rls-printing:3,-:1' then
        raise exception 'add_riftbound_deck_card() does not add an unpinned copy';
    end if;
    -- Versions (#176): the save and the add are one each, the last the deck as it is.
    if (select array_agg(version order by version) from public.riftbound_deck_versions where deck_id = deck) <> array[1, 2]
        or (select jsonb_array_length(entries) from public.riftbound_deck_versions where deck_id = deck and version = 2) <> 2 then
        raise exception 'a save or an add does not keep a version of the deck';
    end if;
    begin
        perform public.save_riftbound_deck(deck, 'mine', null, null, null, 'private', 'en', true,
            '[{"section":"main","card_id":"rls-card-2","printing_id":"rls-printing","quantity":1}]');
        raise exception 'a deck entry is pinned to a printing of another card';
    exception when foreign_key_violation then null;
    end;
    begin
        perform public.add_riftbound_deck_card((select id from public.riftbound_decks where name = 'public'), 'rls-card');
        raise exception 'a member adds cards to someone else''s deck';
    exception when raise_exception then
        if sqlerrm <> 'not your deck' then raise; end if;
    end;
    perform public.delete_riftbound_deck((select id from public.riftbound_decks where name = 'public'));
    if not exists (select from public.riftbound_decks where name = 'public') then
        raise exception 'a member deletes someone else''s deck';
    end if;
    perform public.delete_riftbound_deck(deck);
    if exists (select from public.riftbound_decks where id = deck) then raise exception 'delete_riftbound_deck() keeps your deck'; end if;
    -- Opened decks (#174): only someone else's public one is remembered.
    perform public.open_riftbound_deck(id) from public.riftbound_decks where user_id like 'rls-%';
    if (select array_agg(d.name) from public.riftbound_deck_opens o join public.riftbound_decks d on d.id = o.deck_id) <> array['public'] then
        raise exception 'open_riftbound_deck() remembers a deck that is not someone else''s public one';
    end if;
    -- Wishlists (#177): your own entries directly, others' as their profile, a shared deck numbered per card only.
    if exists (select from public.riftbound_wishlist) then raise exception 'a member reads someone else''s wishlist entries'; end if;
    if (select string_agg(card_id || ':' || coalesce(w.deck::text, '-') || ':' || decks || ':' || coalesce(manual::text, '-')
            || ':' || jsonb_array_length(copies), ',' order by card_id, w.deck)
            from public.profile_wishlist('rls-rls-mine') w) <> 'rls-card:1:1:-:1,rls-card:2:1:-:1,rls-card-2:-:0:2:0'
        or exists (select from public.profile_wishlist('rls-rls-other')) or exists (select from public.profile_wishlist('rls-hidden')) then
        raise exception 'profile_wishlist() does not follow the profile, or does not keep shared decks apart';
    end if;
    perform public.set_riftbound_wish('rls-card', 'rls-printing', 3);
    perform public.set_riftbound_wish('rls-card', 'rls-printing', 5);
    perform public.set_riftbound_wish('rls-card-2', null, 1);
    perform public.set_riftbound_wish('rls-card-2', null, 0);
    if (select string_agg(card_id || ':' || quantity, ',') from public.riftbound_wishlist) <> 'rls-card:5' then
        raise exception 'set_riftbound_wish() does not save an absolute count, or keeps one at 0';
    end if;
    begin
        perform public.set_riftbound_wish('rls-card-2', 'rls-printing', 1);
        raise exception 'a wishlist entry is pinned to a printing of another card';
    exception when foreign_key_violation then null;
    end;
    -- CSV import (#242): adds to the caller's 3 copies and wish of 5, skips unknown ids, caps wants at
    -- 99. Undone by the block's own exception, so the checks below see the rows as they were.
    begin
        if (select copies || ':' || wishes from public.import_riftbound_collection(
                '[{"printing_id":"rls-printing","quantity":2,"want":3},{"printing_id":"rls-printing","quantity":1,"want":0},
                  {"printing_id":"rls-unknown","quantity":5,"want":5}]')) <> '3:1' then
            raise exception 'import_riftbound_collection() does not add to what the caller has';
        end if;
        -- Its own statement, as for own_riftbound_playset() above.
        if (select sum(quantity) from public.riftbound_collection where printing_id = 'rls-printing') is distinct from 6
            or (select quantity from public.riftbound_wishlist where printing_id = 'rls-printing') is distinct from 8 then
            raise exception 'import_riftbound_collection() does not add to what the caller has';
        end if;
        perform public.import_riftbound_collection('[{"printing_id":"rls-printing","quantity":0,"want":95}]');
        if (select quantity from public.riftbound_wishlist where printing_id = 'rls-printing') <> 99 then
            raise exception 'import_riftbound_collection() wants more than 99';
        end if;
        raise exception 'rls-import-done';
    exception when raise_exception then
        if sqlerrm <> 'rls-import-done' then raise; end if;
    end;
    perform public.set_wishlist_mode('dedicated');
    deck := public.save_riftbound_deck(null, 'preset', null, null, null, null, null, null, null);
    if (select wishlist_mode from public.riftbound_decks where id = deck) <> 'dedicated' then
        raise exception 'a new deck does not take the wishlist mode asked once';
    end if;
    perform public.save_riftbound_deck(deck, 'preset', null, null, null, 'private', 'en', true, null);
    if (select wishlist_mode from public.riftbound_decks where id = deck) <> 'dedicated' then
        raise exception 'a save without a wishlist mode changes the deck''s';
    end if;
    -- Trades (#178): only visible members of the visitor's server, never the bot's bookkeeping.
    if (select array_agg(user_id || ':' || copies || ':' || place_kind) from public.guild_trade_offers('rls-mine', array['rls-card']))
            <> array['rls-rls-mine:1:city']
        or exists (select from public.guild_trade_offers('rls-other', array['rls-card'])) then
        raise exception 'guild_trade_offers() lists a hidden or private member, or another server''s';
    end if;
    if exists (select from public.riftbound_trade_matches) then raise exception 'a member reads trade matches'; end if;
    begin
        perform public.riftbound_wish_rows('rls-rls-other');
        raise exception 'a member reads a wishlist past its profile''s visibility';
    exception when insufficient_privilege then null;
    end;
    -- One left for /forget-me to delete, with the wishlist entry above.
    perform public.save_riftbound_deck(null, 'kept', null, null, null, null, null, null, null);
    if (select icon from public.guild_games('rls-mine', current_date)) is distinct from 'i' then
        raise exception 'guild_games() does not return the game icon';
    end if;
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
    -- A hidden member's messages count towards the total without being readable one by one.
    if public.message_total('2026-01-01', 'rls-mine') <> 2 then
        raise exception 'message_total() leaves out hidden members';
    end if;
    if public.message_total('2026-01-01', 'rls-other') <> 0 then
        raise exception 'a member reads another server''s message_total()';
    end if;
    if (select count(*) from public.my_guilds()) <> 1 then raise exception 'my_guilds() is not just mine'; end if;
    if public.monthly_recap('rls-mine', '2025-12-01') is null then raise exception 'a member cannot read their recap'; end if;
    if public.monthly_recap('rls-other', '2025-12-01') is not null then raise exception 'a member reads another server''s recap'; end if;
end $$;

-- Trade matches as the bot reads them (#178): the test user wants rls-card (set_riftbound_wish()
-- above); only rls-rls-mine may be named to them, once, and they meet at the best place known.
set role postgres;
do $$
begin
    if (select array_agg(trader_id || ':' || guild_id || ':' || place_kind) from public.riftbound_trade_candidates()
            where user_id = 'rls-user') <> array['rls-rls-mine:rls-mine:city'] then
        raise exception 'riftbound_trade_candidates() names a hidden or private member, or one in no shared server';
    end if;
    insert into public.store_regulars (guild_id, store_id, user_id)
    select 'rls-mine', id, 'rls-rls-mine' from public.stores where guild_id = 'rls-mine';
    if (select kind from public.riftbound_meeting_place('rls-mine', 'rls-user', 'rls-rls-mine')) <> 'regulars' then
        raise exception 'riftbound_meeting_place() does not prefer a store both are regulars of';
    end if;
    insert into public.event_attendees (guild_id, event_id, user_id)
    select 'rls-mine', id, 'rls-rls-mine' from public.events where guild_id = 'rls-mine';
    if (select kind from public.riftbound_meeting_place('rls-mine', 'rls-user', 'rls-rls-mine')) <> 'event' then
        raise exception 'riftbound_meeting_place() does not prefer an event both are going to';
    end if;
    insert into public.riftbound_trade_matches (user_id, trader_id, card_id)
    values ('rls-user', 'rls-rls-mine', 'rls-card'), ('rls-rls-mine', 'rls-user', 'rls-card');
    if exists (select from public.riftbound_trade_candidates() where user_id = 'rls-user') then
        raise exception 'riftbound_trade_candidates() offers a match the bot DMed about already';
    end if;
end $$;

-- Your own profile still shows your stats in a server where you ran /hide-me (#100).
set role postgres;
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

-- The lending ledger (#172), as the bot writes it: append-only, an owner lends only copies in
-- hand, a correction replaces a loan, answers replace each other, one nudge, one close.
set role postgres;
do $$
declare cards constant jsonb := '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"en","quantity":1}]';
    first bigint := (select id from public.riftbound_loans where lender_id = 'rls-rls-mine');
    wrong bigint; fixed bigint;
begin
    begin
        update public.riftbound_loans set due_on = current_date where id = first;
        raise exception 'a loan can be edited';
    exception when raise_exception then
        if sqlerrm not like '%append-only%' then raise; end if;
    end;
    -- rls-rls-mine has 2: one is out, this takes the other.
    wrong := public.lend_riftbound_cards('rls-rls-mine', 'rls-user', null, null, cards);
    begin
        perform public.lend_riftbound_cards('rls-rls-mine', 'rls-public', null, null, cards);
        raise exception 'an owner lends a copy that is out already';
    exception when raise_exception then
        if sqlerrm not like '%only the owner%' then raise; end if;
    end;
    begin
        perform public.lend_riftbound_cards('rls-public', 'rls-user', null, null, cards);
        raise exception 'a borrower lends a copy on';
    exception when raise_exception then
        if sqlerrm not like '%only the owner%' then raise; end if;
    end;
    begin
        perform public.lend_riftbound_cards('rls-public', 'rls-user', null, wrong, '[]');
        raise exception 'a member corrects someone else''s loan';
    exception when raise_exception then
        if sqlerrm <> 'not_your_loan' then raise; end if;
    end;
    -- Lent to the wrong member: /lend offers the copies of the loan it corrects, and the
    -- correction frees them.
    if (select lent from public.riftbound_lend_options('rls-rls-mine', array['rls-card'], null)) <> 2
        or (select lent from public.riftbound_lend_options('rls-rls-mine', array['rls-card'], wrong)) <> 1
        or (select lent from public.riftbound_lend_options('rls-rls-mine', array['rls-card'], first)) <> 1 then
        raise exception 'riftbound_lend_options() does not count only the corrected loan''s copies as free';
    end if;
    fixed := public.lend_riftbound_cards('rls-rls-mine', 'rls-public', current_date, wrong, cards);
    if public.riftbound_loan_state(wrong) <> 'replaced' or public.riftbound_loan_state(fixed) <> 'open' then
        raise exception 'a correction does not replace the loan';
    end if;
    if public.answer_riftbound_loan('rls-rls-mine', first, 'confirmed', null) <> 'not_borrower'
        or public.answer_riftbound_loan('rls-user', first, 'disputed', 'I got none') <> 'ok'
        or public.answer_riftbound_loan('rls-user', first, 'confirmed', null) <> 'ok'
        or public.answer_riftbound_loan('rls-user', first, 'confirmed', null) <> 'unchanged' then
        raise exception 'answer_riftbound_loan() lets someone else answer, or does not save answers';
    end if;
    if not exists (select from public.riftbound_loan_entries c join public.riftbound_loan_entries d on d.id = c.replaces
                   where c.loan_id = first and c.kind = 'confirmed' and d.kind = 'disputed' and d.note = 'I got none') then
        raise exception 'a new answer does not replace the dispute';
    end if;
    if (select array_agg(loan_id) from public.nudge_riftbound_loans(current_date) where lender_id like 'rls-%') <> array[fixed]
        or exists (select from public.nudge_riftbound_loans(current_date) where lender_id like 'rls-%') then
        raise exception 'nudge_riftbound_loans() does not nudge a due loan exactly once';
    end if;
    if exists (select from public.close_riftbound_loans('rls-user', 'rls-rls-mine', 'written_off', null)) then
        raise exception 'a borrower writes off a loan';
    end if;
    if (select array_agg(loan_id) from public.close_riftbound_loans('rls-user', 'rls-rls-mine', 'returned', null)) <> array[first]
        or exists (select from public.close_riftbound_loans('rls-rls-mine', 'rls-user', 'returned', null))
        or public.answer_riftbound_loan('rls-user', first, 'disputed', 'x') <> 'closed' then
        raise exception 'close_riftbound_loans() does not close the open loans once, either way';
    end if;
    if (select array_agg(loan_id) from public.close_riftbound_loans('rls-rls-mine', 'rls-public', 'written_off', null)) <> array[fixed] then
        raise exception 'an owner cannot write off a loan';
    end if;
    if public.riftbound_loan_state(fixed) <> 'written_off' then raise exception 'a write-off does not close the loan'; end if;
end $$;

-- Borrow requests (#299), as the bot answers them: Accept records the loan through
-- lend_riftbound_cards() and answers once, Decline once, and each DM is claimed once. Every
-- loan above is closed; the one accepted here is returned at the end, for the checks below.
set role postgres;
do $$
declare cards constant jsonb := '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"en","quantity":1}]';
    asked bigint; declined bigint; loan bigint;
begin
    insert into public.riftbound_borrow_requests (borrower_id, lender_id, languages) values ('rls-user', 'rls-rls-mine', '{en}')
    returning id into asked;
    insert into public.riftbound_borrow_requests (borrower_id, lender_id, languages) values ('rls-user', 'rls-rls-mine', '{en}')
    returning id into declined;
    insert into public.riftbound_borrow_request_cards (request_id, card_id, quantity) values (asked, 'rls-card', 1), (declined, 'rls-card', 1);
    if (select array_agg(request_id || ':' || recipient order by request_id) from public.claim_borrow_request_dms()
        where request_id in (asked, declined)) is distinct from array[asked || ':lender', declined || ':lender'] then
        raise exception 'claim_borrow_request_dms() does not hand out the lender''s DMs';
    end if;
    if exists (select from public.claim_borrow_request_dms() where request_id in (asked, declined)) then
        raise exception 'claim_borrow_request_dms() hands out the lender''s DMs twice';
    end if;
    begin
        perform public.accept_riftbound_borrow_request('rls-user', asked, null, cards);
        raise exception 'the borrower accepts their own request';
    exception when raise_exception then
        if sqlerrm <> 'not_lender' then raise; end if;
    end;
    begin
        perform public.accept_riftbound_borrow_request('rls-rls-mine', asked, null, jsonb_set(cards, '{0,quantity}', '2'));
        raise exception 'Accept lends other copies than the request asks for';
    exception when raise_exception then
        if sqlerrm <> 'not_the_request' then raise; end if;
    end;
    loan := public.accept_riftbound_borrow_request('rls-rls-mine', asked, null, cards);
    if not exists (select from public.riftbound_loans l where l.id = loan and l.lender_id = 'rls-rls-mine' and l.borrower_id = 'rls-user')
        or not exists (select from public.riftbound_borrow_request_answers a where a.request_id = asked and a.kind = 'accepted' and a.loan_id = loan) then
        raise exception 'Accept does not record the loan, or the answer pointing at it';
    end if;
    begin
        perform public.accept_riftbound_borrow_request('rls-rls-mine', asked, null, cards);
        raise exception 'a request is accepted twice';
    exception when raise_exception then
        if sqlerrm <> 'closed' then raise; end if;
    end;
    if public.decline_riftbound_borrow_request('rls-user', declined, null) <> 'not_lender'
        or public.decline_riftbound_borrow_request('rls-rls-mine', declined, ' Lent out ') <> 'ok'
        or public.decline_riftbound_borrow_request('rls-rls-mine', declined, null) <> 'closed' then
        raise exception 'decline_riftbound_borrow_request() lets someone else decline, or does not decline once';
    end if;
    if (select note from public.riftbound_borrow_request_answers where request_id = declined and kind = 'declined') is distinct from 'Lent out' then
        raise exception 'Decline does not keep the reason';
    end if;
    if (select array_agg(request_id || ':' || recipient order by request_id) from public.claim_borrow_request_dms()
        where request_id in (asked, declined)) is distinct from array[asked || ':borrower', declined || ':borrower'] then
        raise exception 'claim_borrow_request_dms() does not hand out the borrower''s DMs';
    end if;
    if exists (select from public.claim_borrow_request_dms() where request_id in (asked, declined)) then
        raise exception 'claim_borrow_request_dms() hands out the borrower''s DMs twice';
    end if;
    if (select array_agg(loan_id) from public.close_riftbound_loans('rls-rls-mine', 'rls-user', 'returned', null)) <> array[loan] then
        raise exception 'the accepted loan cannot be returned';
    end if;
end $$;

-- Decks and lending (#179): a deck not for lending holds its cards back from lending, a deck is
-- lent whole as one loan that names it, and the site takes only the borrower's answers. Every
-- loan above is closed, so rls-rls-mine has both copies in hand.
set role postgres;
do $$
declare kept uuid := (select id from public.riftbound_decks where user_id = 'rls-rls-mine' and name = 'private');
begin
    if (select copies from public.riftbound_free_to_lend('rls-rls-mine') where card_id = 'rls-card') <> '[{"language":"en","copies":2}]' then
        raise exception 'riftbound_free_to_lend() does not offer the copies in hand';
    end if;
    update public.riftbound_decks set not_for_lending = true where id = kept;
    if (select copies from public.riftbound_free_to_lend('rls-rls-mine') where card_id = 'rls-card') <> '[{"language":"en","copies":1}]'
        or (select holds from public.riftbound_lend_options('rls-rls-mine', array['rls-card'], null)) <> '[{"language":"en","copies":1}]' then
        raise exception 'a deck not for lending does not hold its cards back';
    end if;
    -- Per language (#296): 2 EN and 1 FR, the English deck holds 1 EN, so 1 of each is free;
    -- once it holds 3, the FR one too, and no language is left to list.
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
    values ('rls-rls-mine', 'rls-printing', 'normal', 'NM', 'fr', 1);
    if (select copies from public.riftbound_free_to_lend('rls-rls-mine') where card_id = 'rls-card')
        <> '[{"language":"en","copies":1},{"language":"fr","copies":1}]' then
        raise exception 'riftbound_free_to_lend() does not hold a deck''s copies in its own language first';
    end if;
    update public.riftbound_deck_cards set quantity = 2 where deck_id = kept;
    if (select copies from public.riftbound_free_to_lend('rls-rls-mine') where card_id = 'rls-card') <> '[{"language":"fr","copies":1}]' then
        raise exception 'riftbound_free_to_lend() lists a language with no free copy';
    end if;
    update public.riftbound_deck_cards set quantity = 3 where deck_id = kept;
    if exists (select from public.riftbound_free_to_lend('rls-rls-mine') where card_id = 'rls-card') then
        raise exception 'riftbound_free_to_lend() does not spill a deck''s hold into other languages';
    end if;
    update public.riftbound_deck_cards set quantity = 1 where deck_id = kept;
    delete from public.riftbound_collection where user_id = 'rls-rls-mine' and language = 'fr';
    begin
        perform public.lend_riftbound_cards('rls-rls-mine', 'rls-user', null, null, '[]', kept);
        raise exception 'a deck not for lending is lent';
    exception when raise_exception then
        if sqlerrm <> 'not_lendable_deck' then raise; end if;
    end;
end $$;

set local role authenticated;
do $$
declare deck uuid; loan bigint;
    cards constant jsonb := '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"zh-Hans","quantity":1}]';
begin
    if (select array_agg(card_id || ':' || user_id || ':' || copies) from public.riftbound_card_lenders(array['rls-card', 'rls-card-2']))
        <> array['rls-card:rls-rls-mine:[{"copies": 1, "language": "en"}]'] then
        raise exception 'riftbound_card_lenders() offers copies a deck not for lending holds, or lenders who may not show';
    end if;
    if (select array_agg(coalesce(printing_id, '-') || ':' || copies order by printing_id nulls first)
        from public.riftbound_card_lenders(array['rls-card'], array['rls-printing'])) <> array['-:[{"copies": 1, "language": "en"}]', 'rls-printing:[{"copies": 1, "language": "en"}]']
        or exists (select from public.riftbound_card_lenders(array['rls-card'], array['rls-printing'], 'fr')) then
        raise exception 'riftbound_card_lenders() does not match a pinned printing, or offers copies in another language';
    end if;
    deck := public.save_riftbound_deck(null, 'lend me', null, null, null, null, null, null,
        '[{"section":"main","card_id":"rls-card","printing_id":null,"quantity":1}]');
    if (select string_agg(language || ':' || quantity || ':' || lendable || ':' || holds, ',')
        from public.my_riftbound_lend_options(array['rls-card'])) <> 'zh-Hans:3:0:[]' then
        raise exception 'my_riftbound_lend_options() is not the caller''s own copies';
    end if;
    -- The caller marks none of those to lend (#300).
    if (select free || ':' || held from public.my_lending_summary()) <> '0:0' then
        raise exception 'my_lending_summary() is not the caller''s own copies to lend';
    end if;
    begin
        perform public.lend_my_riftbound_deck(deck, 'rls-rls-other', null, cards);
        raise exception 'a deck is lent to someone in none of the lender''s servers';
    exception when raise_exception then
        if sqlerrm not like 'lend to a member%' then raise; end if;
    end;
    loan := public.lend_my_riftbound_deck(deck, 'rls-rls-mine', current_date, cards);
    if (select deck_name from public.profile_loans('rls-rls-mine') where id = loan) is distinct from 'lend me' then
        raise exception 'a deck loan does not name its deck';
    end if;
    -- The browser picks the copies, so the database checks they are the deck: card for card, in hand.
    begin
        perform public.lend_my_riftbound_deck(null, 'rls-rls-mine', null, cards);
        raise exception 'a loan without a deck is recorded on the site';
    exception when raise_exception then
        if sqlerrm <> 'not_lendable_deck' then raise; end if;
    end;
    begin
        perform public.lend_my_riftbound_deck(deck, 'rls-rls-mine', null, '[]');
        raise exception 'a deck is lent with no cards';
    exception when raise_exception then
        if sqlerrm <> 'those copies are not the deck as saved' then raise; end if;
    end;
    begin
        perform public.lend_my_riftbound_deck(deck, 'rls-rls-mine', null,
            '[{"printing_id":"rls-nope","finish":"normal","condition":"NM","language":"zh-Hans","quantity":1}]');
        raise exception 'a deck is lent as cards that are not in it';
    exception when raise_exception then
        if sqlerrm <> 'those copies are not the deck as saved' then raise; end if;
    end;
    begin
        perform public.lend_my_riftbound_deck(deck, 'rls-rls-mine', null,
            '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"zh-Hans","quantity":2}]');
        raise exception 'a deck is lent with more copies than it has';
    exception when raise_exception then
        if sqlerrm <> 'those copies are not the deck as saved' then raise; end if;
    end;
    begin
        perform public.lend_my_riftbound_deck(public.save_riftbound_deck(null, 'too many', null, null, null, null, null, null,
            '[{"section":"main","card_id":"rls-card","printing_id":null,"quantity":3}]'), 'rls-rls-mine', null,
            '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"zh-Hans","quantity":3}]');
        raise exception 'a deck is lent with copies out on a loan already';
    exception when raise_exception then
        if sqlerrm not like 'only the owner lends a card%' then raise; end if;
    end;
    if public.answer_my_riftbound_loan(loan, 'confirmed', null) <> 'not_borrower'
        or public.answer_my_riftbound_loan(loan, 'returned', null) <> 'not_borrower'
        or (select state from public.profile_loans('rls-rls-mine') where id = loan) <> 'open' then
        raise exception 'answer_my_riftbound_loan() takes an answer that is not the borrower''s';
    end if;
    perform public.set_riftbound_deck_lending(deck, true);
    begin
        perform public.lend_my_riftbound_deck(deck, 'rls-rls-mine', null, cards);
        raise exception 'a deck not for lending is lent on the site';
    exception when raise_exception then
        if sqlerrm <> 'not_lendable_deck' then raise; end if;
    end;
    begin
        perform public.set_riftbound_deck_lending((select id from public.riftbound_decks where name = 'servers-shared'), true);
        raise exception 'a member marks someone else''s deck not for lending';
    exception when raise_exception then
        if sqlerrm <> 'not your deck' then raise; end if;
    end;
end $$;

-- /forget-me (#72): no row about the user is left anywhere, and none can be written again
-- until remember_user().
set role postgres;
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
    if exists (select from public.riftbound_trade_matches where trader_id = 'rls-user') then
        raise exception 'forget_user() leaves the matches where the user is the trader';
    end if;
    if exists (select from public.riftbound_deck_versions where name = 'kept') then
        raise exception 'forget_user() leaves the versions of the user''s decks';
    end if;
    -- Their loans go; the correction that replaced one stays, without the link (#172).
    if exists (select from public.riftbound_loans where 'rls-user' in (lender_id, borrower_id))
        or exists (select from public.riftbound_loans where borrower_id = 'rls-public' and lender_id = 'rls-rls-mine' and replaces is not null) then
        raise exception 'forget_user() leaves the user''s loans';
    end if;
    if exists (select from public.riftbound_borrow_requests where 'rls-user' in (lender_id, borrower_id)) then
        raise exception 'forget_user() leaves the user''s borrow requests';
    end if;
    if public.lend_riftbound_cards('rls-rls-mine', 'rls-user', null, null,
        '[{"printing_id":"rls-printing","finish":"normal","condition":"NM","language":"en","quantity":1}]') is not null then
        raise exception 'a forgotten user is lent cards';
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
