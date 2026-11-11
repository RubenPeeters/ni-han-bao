-- Checks my_data() (#352): two members share a server, a loan, a borrow request and a trade
-- match. Each gets their own rows and the other only as a display name; logged out, nothing.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/my_data.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

do $$
declare n int; u text; s bigint; e bigint; d uuid; l bigint; r bigint;
begin
    insert into public.guilds (guild_id, name) values ('md-g', 'md-server');
    insert into public.channels (guild_id, channel_id, name) values ('md-g', 'c', 'general');
    insert into public.emojis (guild_id, emoji_key, name) values ('md-g', 'e', 'e');
    insert into public.riftbound_cards (id, name, type) values ('md-card', 'md-card-name', 'Spell');
    insert into public.riftbound_printings (id, card_id, set_code, collector_code, collector_number)
    values ('md-print', 'md-card', 'MD', 'MD-001', 1);
    -- Everything private to a member carries their number, n: 1 for md-a, 2 for md-b.
    for n in 1..2 loop
        u := case n when 1 then 'md-a' else 'md-b' end;
        insert into auth.users (id) values (('00000000-0000-4000-8000-00000000035' || n)::uuid);
        insert into auth.identities (provider_id, user_id, identity_data, provider)
        values (u, ('00000000-0000-4000-8000-00000000035' || n)::uuid, jsonb_build_object('sub', u), 'discord');
        insert into public.profiles (user_id, favourite_champion) values (u, 'MdChampion' || n);
        insert into public.guild_members (guild_id, user_id) values ('md-g', u);
        insert into public.members (guild_id, user_id, display_name) values ('md-g', u, 'md-name-' || n);
        insert into public.onboarding_dms (guild_id, user_id) values ('md-g', u);
        insert into public.message_counts (guild_id, user_id, day, count) values ('md-g', u, '2026-01-01', 7100 + n);
        insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count) values ('md-g', u, 'c', '2026-01-01', 7200 + n);
        insert into public.reactions_received (guild_id, user_id, day, count) values ('md-g', u, '2026-01-01', 7300 + n);
        insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count) values ('md-g', u, 'e', '2026-01-01', 7400 + n);
        insert into public.voice_seconds (guild_id, user_id, day, seconds) values ('md-g', u, '2026-01-01', 7500 + n);
        insert into public.activity_seconds (user_id, day, kind, name, seconds) values (u, '2026-01-01', 'playing', 'md-game-' || n, 60);
        insert into public.game_accounts (user_id, game, external_id, region) values (u, 'lol', 'md-puuid-' || n, 'euw1');
        insert into public.lol_ranks (user_id, queue, tier, lp) values (u, 'RANKED_SOLO_5x5', 'GOLD', 7600 + n);
        insert into public.lol_rank_changes (user_id, puuid, queue, tier, lp) values (u, 'md-puuid-' || n, 'RANKED_SOLO_5x5', 'GOLD', 7600 + n);
        insert into public.lol_matches (user_id, puuid, match_id, queue_id, champion, played_at)
        values (u, 'md-puuid-' || n, 'md-match-' || n, 420, 'Ahri', now());
        insert into public.riftbound_collection (user_id, printing_id, finish, condition, quantity) values (u, 'md-print', 'normal', 'NM', 10 + n);
        insert into public.riftbound_collection_activity (user_id, day, copies_added) values (u, '2026-01-01', 20 + n);
        insert into public.riftbound_playset_goals (user_id, set_code) values (u, 'md-set-' || n);
        insert into public.riftbound_decks (user_id, name, visibility) values (u, 'md-deck-' || n, 'public') returning id into d;
        insert into public.riftbound_deck_cards (deck_id, section, card_id, quantity) values (d, 'main', 'md-card', 1);
        insert into public.riftbound_deck_versions (deck_id, version, name, notes, language, allow_other_languages, entries)
        values (d, 1, 'md-deck-' || n, '', 'en', true, '[]');
        insert into public.riftbound_deck_opens (user_id, deck_id) values (u, d);
        insert into public.riftbound_wishlist (user_id, card_id, quantity) values (u, 'md-card', 30 + n);
        insert into public.stores (guild_id, name, city, added_by) values ('md-g', 'md-store-' || n, 'c', u) returning id into s;
        insert into public.store_regulars (guild_id, store_id, user_id) values ('md-g', s, u);
        insert into public.events (guild_id, store_id, starts_at, name) values ('md-g', s, now(), 'md-event-' || n) returning id into e;
        insert into public.event_attendees (guild_id, event_id, user_id) values ('md-g', e, u);
    end loop;
    -- Shared rows: md-a lends to md-b, md-b asked md-a, md-b has what md-a wants.
    insert into public.riftbound_loans (lender_id, borrower_id) values ('md-a', 'md-b') returning id into l;
    insert into public.riftbound_loan_cards (loan_id, printing_id, finish, condition, language, quantity)
    values (l, 'md-print', 'normal', 'NM', 'en', 1);
    insert into public.riftbound_loan_entries (loan_id, kind, by_id) values (l, 'confirmed', 'md-b');
    insert into public.riftbound_borrow_requests (borrower_id, lender_id, languages) values ('md-b', 'md-a', '{en}') returning id into r;
    insert into public.riftbound_borrow_request_cards (request_id, card_id, quantity) values (r, 'md-card', 1);
    insert into public.riftbound_borrow_request_dms (request_id, recipient) values (r, 'lender'), (r, 'borrower');
    insert into public.riftbound_trade_matches (user_id, trader_id, card_id) values ('md-a', 'md-b', 'md-card');
end;
$$;

-- Logged out: anon may not call it, and a request without a session gets nothing.
do $$
begin
    if has_function_privilege('anon', 'public.my_data()', 'execute') then
        raise exception 'anon may call my_data()';
    end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '', true);
do $$
begin
    if public.my_data() is not null then
        raise exception 'my_data() returns something without a session';
    end if;
end;
$$;

-- md-a: every heading holds their own row, nothing of md-b's but the name on shared rows.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000351","role":"authenticated"}', true);
do $$
declare d jsonb := public.my_data(); t text := public.my_data()::text; v text;
begin
    if d ->> 'discord_id' <> 'md-a' then
        raise exception 'my_data() is not md-a''s: %', d ->> 'discord_id';
    end if;
    foreach v in array array['MdChampion1', 'md-name-1', ': 7101', ': 7201', ': 7301', ': 7401', ': 7501', 'md-game-1', 'md-puuid-1',
        ': 7601', 'md-match-1', '"quantity": 11', '"copies_added": 21', 'md-set-1', 'md-deck-1', '"quantity": 31',
        'md-store-1', 'md-event-1'] loop
        if position(v in t) = 0 then
            raise exception 'md-a''s export lacks %', v;
        end if;
    end loop;
    -- md-b's own rows, and their id anywhere.
    foreach v in array array['md-b', 'MdChampion2', ': 7102', ': 7202', ': 7302', ': 7402', ': 7502', 'md-game-2', 'md-puuid-2',
        ': 7602', 'md-match-2', '"quantity": 12', '"copies_added": 22', 'md-set-2', 'md-deck-2', '"quantity": 32',
        'md-store-2', 'md-event-2'] loop
        if position(v in t) > 0 then
            raise exception 'md-a''s export holds md-b''s %', v;
        end if;
    end loop;
    if jsonb_array_length(d -> 'servers') <> 1 or jsonb_array_length(d -> 'riftbound_decks_opened') <> 1 then
        raise exception 'md-a''s servers or opened decks: %', d -> 'servers';
    end if;
    if d #>> '{riftbound_loans,0,role}' <> 'lender' or d #>> '{riftbound_loans,0,other}' <> 'md-name-2'
        or d #>> '{riftbound_loans,0,entries,0,by}' <> 'other'
        or d #>> '{riftbound_borrow_requests,0,role}' <> 'lender' or d #>> '{riftbound_borrow_requests,0,other}' <> 'md-name-2'
        or d #>> '{riftbound_borrow_requests,0,messages,0,recipient}' <> 'lender'
        or jsonb_array_length(d #> '{riftbound_borrow_requests,0,messages}') <> 1
        or d #>> '{riftbound_trade_matches,0,role}' <> 'wants' or d #>> '{riftbound_trade_matches,0,other}' <> 'md-name-2' then
        raise exception 'md-a''s shared rows: % % %', d -> 'riftbound_loans', d -> 'riftbound_borrow_requests', d -> 'riftbound_trade_matches';
    end if;
end;
$$;

-- md-b, hidden everywhere after /hide-me, gets the shared rows from their side; md-a still sees
-- them, without md-b's name.
reset role;
update public.members set hidden = true where user_id = 'md-b';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000352","role":"authenticated"}', true);
do $$
declare d jsonb := public.my_data(); t text := public.my_data()::text;
begin
    if d ->> 'discord_id' <> 'md-b' or position('md-a' in t) > 0 or position('md-deck-1' in t) > 0
        or position('md-deck-2' in t) = 0 then
        raise exception 'md-b''s export: %', t;
    end if;
    if d #>> '{riftbound_loans,0,role}' <> 'borrower' or d #>> '{riftbound_loans,0,other}' <> 'md-name-1'
        or d #>> '{riftbound_loans,0,entries,0,by}' <> 'me'
        or d #>> '{riftbound_trade_matches,0,role}' <> 'trades' then
        raise exception 'md-b''s shared rows: % %', d -> 'riftbound_loans', d -> 'riftbound_trade_matches';
    end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000351","role":"authenticated"}', true);
do $$
begin
    if public.my_data() #>> '{riftbound_loans,0,other}' is not null then
        raise exception 'md-a sees the name of md-b, who is hidden';
    end if;
end;
$$;

rollback;
