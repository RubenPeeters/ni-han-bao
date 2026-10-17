-- Checks apply_activity (idempotent per batch, voice time and joins/leaves included),
-- member_flow_weekly's Monday weeks, and that top_voice and voice_seconds hide opted-out
-- members, which the bot's unit tests cannot reach.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/server_timeline.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name, hidden) values
    ('t-shown', 'Shown', false),
    ('t-hidden', 'Hidden', true);

-- 2026-10-18 is a Sunday, 2026-10-19 the Monday after: different weeks.
select public.apply_activity(
    '00000000-0000-0000-0000-000000000021',
    '[]',
    '[]',
    '[{"user_id": "t-shown", "day": "2026-10-18", "seconds": 600},
      {"user_id": "t-hidden", "day": "2026-10-18", "seconds": 9000}]',
    '[{"day": "2026-10-18", "joins": 2, "leaves": 1},
      {"day": "2026-10-19", "joins": 1, "leaves": 0}]'
);
-- A retry of the same batch must change nothing.
select public.apply_activity(
    '00000000-0000-0000-0000-000000000021',
    '[]',
    '[]',
    '[{"user_id": "t-shown", "day": "2026-10-18", "seconds": 600}]',
    '[{"day": "2026-10-18", "joins": 2, "leaves": 1}]'
);
-- A new batch adds on top.
select public.apply_activity(
    '00000000-0000-0000-0000-000000000022',
    '[]',
    '[]',
    '[{"user_id": "t-shown", "day": "2026-10-18", "seconds": 60}]',
    '[{"day": "2026-10-18", "joins": 0, "leaves": 1}]'
);

do $$
begin
    if (select seconds from public.voice_seconds where user_id = 't-shown' and day = '2026-10-18') <> 660 then
        raise exception 'voice seconds wrong after a replayed batch';
    end if;
    if (select joins::text || '/' || leaves from public.member_flow where day = '2026-10-18') <> '2/2' then
        raise exception 'member flow wrong after a replayed batch';
    end if;
end;
$$;

set local role anon;

do $$
begin
    if (select joins::text || '/' || leaves from public.member_flow_weekly('2026-10-01')
        where week = '2026-10-12') is distinct from '2/2' then
        raise exception 'Sunday was not counted in the week starting Monday 2026-10-12';
    end if;
    if (select joins::text || '/' || leaves from public.member_flow_weekly('2026-10-01')
        where week = '2026-10-19') is distinct from '1/0' then
        raise exception 'Monday did not start a new week';
    end if;
    if exists (select from public.top_voice('2026-10-01', 1000) where user_id = 't-hidden') then
        raise exception 'hidden member is in top_voice';
    end if;
    if (select seconds from public.top_voice('2026-10-01', 1000) where user_id = 't-shown')
        is distinct from 660::bigint then
        raise exception 'visible member missing or wrong in top_voice';
    end if;
    if exists (select from public.voice_seconds where user_id = 't-hidden') then
        raise exception 'anon can read the hidden member''s voice time';
    end if;
end;
$$;

-- Only the bot writes.
do $$
begin
    perform public.apply_activity(gen_random_uuid(), '[]', '[]', '[]', '[]');
    raise exception 'anon could call apply_activity';
exception when insufficient_privilege then
    null;
end;
$$;

reset role;
rollback;
\echo server_timeline: ok
