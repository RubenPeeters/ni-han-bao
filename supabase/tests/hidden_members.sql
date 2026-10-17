-- Checks that a hidden member is invisible to the website (the anon role): not on either
-- leaderboard period, and not in the tables the publishable key can query directly.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/hidden_members.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name, hidden) values
    ('t-shown', 'Shown', false),
    ('t-hidden', 'Hidden', true);
insert into public.message_counts (user_id, day, count) values
    ('t-shown', current_date, 1),
    ('t-hidden', current_date, 100),
    ('t-hidden', '2020-01-01', 100);

set local role anon;

do $$
begin
    if exists (select from public.leaderboard(current_date, 1000) where user_id = 't-hidden') then
        raise exception 'hidden member is on the weekly leaderboard';
    end if;
    if exists (select from public.leaderboard(null, 1000) where user_id = 't-hidden') then
        raise exception 'hidden member is on the all-time leaderboard';
    end if;
    if not exists (select from public.leaderboard(null, 1000) where user_id = 't-shown') then
        raise exception 'visible member is missing from the leaderboard';
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
set local role anon;

do $$
begin
    if not exists (select from public.leaderboard(null, 1000) where user_id = 't-hidden') then
        raise exception 'unhidden member is still missing from the leaderboard';
    end if;
end;
$$;

reset role;
rollback;
\echo hidden_members: ok
