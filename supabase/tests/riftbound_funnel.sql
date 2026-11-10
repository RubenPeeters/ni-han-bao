-- Checks riftbound_funnel() (#349) with a few people at different steps, and that only the owner runs it.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/riftbound_funnel.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

-- The demo seed may have rows in these weeks, so the checks compare against this baseline.
create temp table funnel_before as select * from public.riftbound_funnel();
create temp table w (n int primary key, monday date);
insert into w select n, (date_trunc('week', now() at time zone 'utc') - make_interval(weeks => n))::date
from generate_series(0, 20) n;

-- f-a: logs in week -2, first card that week, lends to f-b this week. This week: 5 copies,
-- removed, 5 more (never ten held), then 5 more (ten held).
-- f-b: never logs in, first card in week -1, in f-a's server from before created_at existed.
-- f-c: logged in 20 weeks ago (outside the window), in the server, no collection.
-- f-d: logs in this week, then used /forget-me.
-- f-e and f-f: collections, sharing a server where neither membership has a timestamp. f-e held
-- ten before the ten-copies table existed, so reaching it again this week does not count.
insert into auth.users (id, created_at) values
    ('00000000-0000-0000-0000-0000000349a0', (select monday from w where n = 2) + time '12:00'),
    ('00000000-0000-0000-0000-0000000349c0', (select monday from w where n = 20) + time '12:00'),
    ('00000000-0000-0000-0000-0000000349d0', (select monday from w where n = 0) + time '00:01');
insert into auth.identities (user_id, provider, provider_id, identity_data) values
    ('00000000-0000-0000-0000-0000000349a0', 'discord', 'f-a', '{"sub": "f-a"}'),
    ('00000000-0000-0000-0000-0000000349c0', 'discord', 'f-c', '{"sub": "f-c"}'),
    ('00000000-0000-0000-0000-0000000349d0', 'discord', 'f-d', '{"sub": "f-d"}');
insert into public.forgotten_users (user_hash) values (public.user_hash('f-d'));
insert into public.riftbound_collection_activity (user_id, day, copies_added) values
    ('f-a', (select monday from w where n = 2), 5),
    ('f-a', (select monday from w where n = 1) + 3, 5),
    ('f-b', (select monday from w where n = 1), 1),
    ('f-e', (select monday from w where n = 1), 1),
    ('f-f', (select monday from w where n = 1), 1);
insert into public.guild_members (guild_id, user_id, created_at) values
    ('f-g', 'f-a', (select monday from w where n = 3)),
    ('f-g', 'f-b', null),
    ('f-g', 'f-c', now()),
    ('f-h', 'f-e', null),
    ('f-h', 'f-f', null);
insert into public.riftbound_ten_copies (user_id, reached_at) values ('f-e', null);
insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
values ('f-a', 'ogn-255-298', 'normal', 'NM', 'en', 5);
delete from public.riftbound_collection where user_id = 'f-a';
insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
values ('f-a', 'ogn-255-298', 'normal', 'NM', 'en', 5), ('f-e', 'ogn-255-298', 'normal', 'NM', 'en', 10);
do $$
begin
    if exists (select from public.riftbound_ten_copies where user_id = 'f-a') then
        raise exception 'additions separated by a removal count as ten held';
    end if;
end;
$$;
update public.riftbound_collection set quantity = 10 where user_id = 'f-a';
insert into public.riftbound_loans (lender_id, borrower_id) values ('f-a', 'f-b');

do $$
declare got text;
begin
    select string_agg(format('%s:%s/%s/%s/%s/%s', w.n,
        a.logged_in - b.logged_in, a.first_card - b.first_card, a.ten_cards - b.ten_cards,
        a.shares_server - b.shares_server, a.first_loan_or_trade - b.first_loan_or_trade), ' ' order by w.n)
    into got
    from public.riftbound_funnel() a join funnel_before b using (week) join w on w.monday = a.week;
    if got is distinct from '0:0/0/1/0/2 1:0/3/0/2/0 2:1/1/0/0/0 3:0/0/0/0/0 4:0/0/0/0/0 5:0/0/0/0/0 '
        '6:0/0/0/0/0 7:0/0/0/0/0 8:0/0/0/0/0 9:0/0/0/0/0 10:0/0/0/0/0 11:0/0/0/0/0' then
        raise exception 'riftbound_funnel() added %', got;
    end if;
end;
$$;

-- For the owner only.
set local role anon;
do $$
begin
    perform public.riftbound_funnel();
    raise exception 'anon runs riftbound_funnel()';
exception when insufficient_privilege then null;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
    perform public.riftbound_funnel();
    raise exception 'authenticated runs riftbound_funnel()';
exception when insufficient_privilege then null;
end;
$$;

reset role;
rollback;
\echo riftbound_funnel: ok
