-- Checks public_totals() for anon and my_guilds() for a logged-in visitor and for anon.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/public_totals.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

-- An empty database, so the totals below are exactly the rows inserted here.
delete from public.message_counts;
delete from public.guild_members;
delete from public.guilds;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1');
insert into auth.identities (user_id, provider, provider_id, identity_data) values
    ('00000000-0000-0000-0000-0000000000b1', 'discord', 't-discord', '{"sub": "t-discord"}');
insert into public.guilds (guild_id, name) values ('t-a', 'Bravo'), ('t-b', 'Alpha'), ('t-c', 'Other');
-- t-discord is in two servers and counts once; t-hidden is hidden and still counts.
insert into public.guild_members (guild_id, user_id) values
    ('t-a', 't-discord'), ('t-b', 't-discord'), ('t-c', 't-hidden');
insert into public.members (guild_id, user_id, display_name, hidden) values
    ('t-a', 't-discord', 'Me', false), ('t-c', 't-hidden', 'Hidden', true);
insert into public.message_counts (guild_id, user_id, day, count) values
    ('t-a', 't-discord', '2026-10-12', 5),
    ('t-c', 't-hidden', '2026-10-13', 2),
    ('t-a', 't-discord', '2026-10-01', 100);

set local role anon;

do $$
declare t record;
begin
    select * into t from public.public_totals('2026-10-12');
    if (t.servers, t.members, t.messages_since, t.active_since) is distinct from (3::bigint, 2::bigint, 7::bigint, 2::bigint) then
        raise exception 'public_totals() is %', t;
    end if;
    if exists (select from public.my_guilds()) then
        raise exception 'anon has servers';
    end if;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1"}';

do $$
begin
    if (select array_agg(name) from public.my_guilds()) is distinct from array['Alpha', 'Bravo'] then
        raise exception 'my_guilds() is %', (select array_agg(name) from public.my_guilds());
    end if;
end;
$$;

reset role;
rollback;
\echo public_totals: ok
