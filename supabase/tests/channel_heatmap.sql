-- Checks increment_activity (idempotent per batch, both kinds of counts) and that
-- channel_heatmap buckets by UTC weekday and hour, which the bot's unit tests cannot reach.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/channel_heatmap.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

-- A non-UTC session must not shift any bucket.
set local timezone = 'Europe/Brussels';

insert into public.members (user_id, display_name) values ('t1', 'Test One');
insert into public.channels (channel_id, name) values ('c1', 'general'), ('c2', 'memes');

-- 2026-10-18 is a Sunday: its last UTC hour and Monday's first must land in different rows.
select public.increment_activity(
    '00000000-0000-0000-0000-000000000011',
    '[{"user_id": "t1", "day": "2026-10-18", "count": 3}]',
    '[{"channel_id": "c1", "hour": "2026-10-18T23:00:00.000Z", "count": 2},
      {"channel_id": "c2", "hour": "2026-10-18T23:00:00.000Z", "count": 1},
      {"channel_id": "c1", "hour": "2026-10-19T00:00:00.000Z", "count": 5}]'
);
-- A retry of the same batch must change nothing.
select public.increment_activity(
    '00000000-0000-0000-0000-000000000011',
    '[{"user_id": "t1", "day": "2026-10-18", "count": 3}]',
    '[{"channel_id": "c1", "hour": "2026-10-18T23:00:00.000Z", "count": 2}]'
);

do $$
begin
    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-18') <> 3 then
        raise exception 'member counts wrong after a replayed batch';
    end if;
    if (select count from public.channel_message_counts
        where channel_id = 'c1' and hour = '2026-10-18T23:00:00Z') <> 2 then
        raise exception 'channel counts wrong after a replayed batch';
    end if;
end;
$$;

-- A timestamp that is not on the hour must be rejected, not stored as its own bucket.
do $$
begin
    insert into public.channel_message_counts (channel_id, hour, count)
    values ('c1', '2026-10-18T23:30:00Z', 1);
    raise exception 'off-hour bucket was accepted';
exception when check_violation then
    null;
end;
$$;

set local role anon;

do $$
begin
    if (select message_count from public.channel_heatmap('2026-10-01T00:00:00Z')
        where weekday = 7 and hour = 23) is distinct from 3::bigint then
        raise exception 'Sunday 23:00 UTC cell is wrong';
    end if;
    if (select message_count from public.channel_heatmap('2026-10-01T00:00:00Z')
        where weekday = 1 and hour = 0) is distinct from 5::bigint then
        raise exception 'Monday 00:00 UTC cell is wrong';
    end if;
    if (select count(*) from public.channel_heatmap('2026-10-01T00:00:00Z')) <> 2 then
        raise exception 'heatmap has unexpected cells';
    end if;
    -- `since` is inclusive and cuts off earlier hours.
    if (select count(*) from public.channel_heatmap('2026-10-19T00:00:00Z')) <> 1 then
        raise exception 'heatmap ignores since';
    end if;

    if (select array_agg(name order by message_count desc)
        from public.busiest_channels('2026-10-01T00:00:00Z', 10)) <> array['general', 'memes'] then
        raise exception 'busiest channels are in the wrong order';
    end if;
end;
$$;

reset role;

-- A rename shows up under the new name, with the counts kept.
update public.channels set name = 'chat' where channel_id = 'c1';
set local role anon;

do $$
begin
    if (select message_count from public.busiest_channels('2026-10-01T00:00:00Z', 1)
        where name = 'chat') is distinct from 7::bigint then
        raise exception 'renamed channel lost its counts';
    end if;
end;
$$;

reset role;
rollback;
\echo channel_heatmap: ok
