-- Checks that a hidden member is invisible to the website: not on either leaderboard period
-- for a member of the server, and not in the tables the publishable key can query directly.
-- leaderboard() is security definer (#258): a non-member and anon get no rows at all.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/hidden_members.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into auth.identities (user_id, provider, provider_id, identity_data) values
    ('00000000-0000-0000-0000-0000000000a1', 'discord', 't-shown', '{"sub": "t-shown"}');
insert into public.guild_members (guild_id, user_id) values ('t-guild', 't-shown');
insert into public.members (guild_id, user_id, display_name, hidden) values
    ('t-guild', 't-shown', 'Shown', false),
    ('t-guild', 't-hidden', 'Hidden', true);
insert into public.message_counts (guild_id, user_id, day, count) values
    ('t-guild', 't-shown', current_date, 1),
    ('t-guild', 't-hidden', current_date, 100),
    ('t-guild', 't-hidden', '2020-01-01', 100);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1"}';

do $$
begin
    if exists (select from public.leaderboard(current_date, 1000, 't-guild') where user_id = 't-hidden') then
        raise exception 'hidden member is on the weekly leaderboard';
    end if;
    if exists (select from public.leaderboard(null, 1000, 't-guild') where user_id = 't-hidden') then
        raise exception 'hidden member is on the all-time leaderboard';
    end if;
    if not exists (select from public.leaderboard(null, 1000, 't-guild') where user_id = 't-shown') then
        raise exception 'visible member is missing from the leaderboard';
    end if;
    if exists (select from public.members where user_id = 't-hidden') then
        raise exception 'a member can read the hidden member row';
    end if;
    if exists (select from public.message_counts where user_id = 't-hidden') then
        raise exception 'a member can read the hidden member''s counts';
    end if;
end;
$$;

reset role;
delete from public.guild_members where user_id = 't-shown';
set local role authenticated;

do $$
begin
    if exists (select from public.leaderboard(null, 1000, 't-guild')) then
        raise exception 'a non-member gets rows from the leaderboard';
    end if;
end;
$$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

do $$
begin
    if exists (select from public.leaderboard(null, 1000, 't-guild')) then
        raise exception 'anon gets rows from the leaderboard';
    end if;
    if exists (select from public.members where user_id = 't-hidden') then
        raise exception 'anon can read the hidden member row';
    end if;
    if exists (select from public.message_counts where user_id = 't-hidden') then
        raise exception 'anon can read the hidden member''s counts';
    end if;
end;
$$;

reset role;

-- /show-me makes them visible again.
update public.members set hidden = false where user_id = 't-hidden';
insert into public.guild_members (guild_id, user_id) values ('t-guild', 't-shown');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1"}';

do $$
begin
    if not exists (select from public.leaderboard(null, 1000, 't-guild') where user_id = 't-hidden') then
        raise exception 'unhidden member is still missing from the leaderboard';
    end if;
end;
$$;

reset role;
rollback;
\echo hidden_members: ok
