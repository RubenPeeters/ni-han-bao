-- Checks that backfill_page counts a page at most once and that backfill_apply never adds
-- history on top of live counts, which the bot's unit tests can only assume. Run against a
-- local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/backfill_page.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name) values ('t1', 'Test One');
insert into public.channels (channel_id, name) values ('c1', 'general');
insert into public.backfill_cursors (channel_id, before_id) values ('c1', '1000');

do $$
begin
    if not public.backfill_page(
        'c1', '1000', '900', false,
        '[{"user_id": "t1", "day": "2026-10-10", "count": 3}]',
        '[{"channel_id": "c1", "hour": "2026-10-10T12:00:00Z", "count": 3}]'
    ) then
        raise exception 'first page was rejected';
    end if;
    -- A retry of the same page (e.g. after a lost response) must change nothing.
    if public.backfill_page(
        'c1', '1000', '900', false,
        '[{"user_id": "t1", "day": "2026-10-10", "count": 3}]',
        '[{"channel_id": "c1", "hour": "2026-10-10T12:00:00Z", "count": 3}]'
    ) then
        raise exception 'replayed page was applied';
    end if;
    -- The next page adds on top and finishes the channel.
    perform public.backfill_page(
        'c1', '900', '800', true,
        '[{"user_id": "t1", "day": "2026-10-10", "count": 2}]',
        '[{"channel_id": "c1", "hour": "2026-10-10T12:00:00Z", "count": 2}]'
    );
    if (select count from public.backfill_message_counts where user_id = 't1' and day = '2026-10-10') <> 5
        or (select count from public.backfill_channel_message_counts where channel_id = 'c1') <> 5 then
        raise exception 'pages were not summed exactly once';
    end if;
    if not (select done from public.backfill_cursors where channel_id = 'c1') then
        raise exception 'last page did not finish the channel';
    end if;
    -- A finished channel takes no more pages.
    if public.backfill_page('c1', '800', '700', true, '[]', '[]') then
        raise exception 'page applied to a finished channel';
    end if;
end;
$$;

-- The live bot counted 2 of that day's 5 messages (it started mid-hour), and all 7 of another day's
-- before 2 of them were deleted. On a third day, 10 pre-bot messages plus 5 live ones of which 2
-- were deleted: the known undercount, documented in the migration.
insert into public.message_counts (user_id, day, count)
values ('t1', '2026-10-10', 2), ('t1', '2026-10-11', 7), ('t1', '2026-10-12', 5);
insert into public.backfill_message_counts (user_id, day, count) values ('t1', '2026-10-11', 5), ('t1', '2026-10-12', 13);
select public.backfill_apply();
-- Applying again (every run does) must change nothing.
select public.backfill_apply();

do $$
begin
    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-10') <> 5 then
        raise exception 'history did not replace the partial live count';
    end if;
    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-11') <> 7 then
        raise exception 'history lowered a live count';
    end if;
    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-12') <> 13 then
        raise exception 'mixed bucket is not the larger of live and history';
    end if;
    if (select count from public.channel_message_counts where channel_id = 'c1') <> 5 then
        raise exception 'history hour was not applied once';
    end if;
end;
$$;

rollback;
\echo backfill_page: ok
