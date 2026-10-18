-- Checks backfill_page: a page is applied only while the cursor is still where it started,
-- so a replayed page or one from a stale run adds nothing. The bot's unit tests use a fake.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/backfill_page.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name) values ('t1', 'Test One');
insert into public.channels (channel_id, name) values ('c1', 'general');
insert into public.backfill_cursors (channel_id, before_id) values ('c1', '300');

do $$
begin
    if not public.backfill_page('c1', '300', '200', false,
        '[{"user_id": "t1", "day": "2026-10-01", "count": 2}]',
        '[{"channel_id": "c1", "hour": "2026-10-01T10:00:00Z", "count": 2}]') then
        raise exception 'first page not applied';
    end if;
    -- The same page again (e.g. its response was lost) must be refused.
    if public.backfill_page('c1', '300', '200', false,
        '[{"user_id": "t1", "day": "2026-10-01", "count": 2}]',
        '[{"channel_id": "c1", "hour": "2026-10-01T10:00:00Z", "count": 2}]') then
        raise exception 'replayed page applied';
    end if;
    if not public.backfill_page('c1', '200', '100', true,
        '[{"user_id": "t1", "day": "2026-10-01", "count": 1}]',
        '[{"channel_id": "c1", "hour": "2026-10-01T09:00:00Z", "count": 1}]') then
        raise exception 'second page not applied';
    end if;
    -- A finished channel takes no more pages.
    if public.backfill_page('c1', '100', '100', true, '[]', '[]') then
        raise exception 'page applied to a finished channel';
    end if;

    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-01') <> 3 then
        raise exception 'member counts wrong';
    end if;
    if (select sum(count) from public.channel_message_counts where channel_id = 'c1') <> 3 then
        raise exception 'channel counts wrong';
    end if;
    if (select before_id from public.backfill_cursors where channel_id = 'c1') <> '100' then
        raise exception 'cursor not moved';
    end if;
end;
$$;

rollback;
\echo backfill_page: ok
