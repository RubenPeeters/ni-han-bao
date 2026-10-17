-- Checks that increment_message_counts applies a batch id at most once, which the bot's
-- unit tests can only assume. Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/increment_message_counts.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name) values ('t1', 'Test One');

select public.increment_message_counts(
    '00000000-0000-0000-0000-000000000001',
    '[{"user_id": "t1", "day": "2026-10-17", "count": 3}]'
);
-- A retry of the same batch (e.g. after a lost response) must change nothing.
select public.increment_message_counts(
    '00000000-0000-0000-0000-000000000001',
    '[{"user_id": "t1", "day": "2026-10-17", "count": 3}]'
);
-- A new batch for the same day adds on top.
select public.increment_message_counts(
    '00000000-0000-0000-0000-000000000002',
    '[{"user_id": "t1", "day": "2026-10-17", "count": 2}]'
);

do $$
begin
    if (select count from public.message_counts where user_id = 't1' and day = '2026-10-17') <> 5 then
        raise exception 'replayed batch was applied twice';
    end if;
end;
$$;

-- A batch that fails (unknown member) must not record its id, so its retry still applies.
do $$
begin
    perform public.increment_message_counts(
        '00000000-0000-0000-0000-000000000003',
        '[{"user_id": "missing", "day": "2026-10-17", "count": 1}]'
    );
    raise exception 'batch for an unknown member should have failed';
exception when foreign_key_violation then
    null;
end;
$$;
insert into public.members (user_id, display_name) values ('missing', 'Late Member');
select public.increment_message_counts(
    '00000000-0000-0000-0000-000000000003',
    '[{"user_id": "missing", "day": "2026-10-17", "count": 1}]'
);

do $$
begin
    if (select count from public.message_counts where user_id = 'missing') is distinct from 1 then
        raise exception 'failed batch id was recorded, so its retry was skipped';
    end if;
end;
$$;

-- Ids past the retention window are pruned by the next call.
insert into public.applied_count_batches (batch_id, applied_at)
values ('00000000-0000-0000-0000-000000000004', now() - interval '8 days');
select public.increment_message_counts('00000000-0000-0000-0000-000000000005', '[]');

do $$
begin
    if exists (select from public.applied_count_batches where batch_id = '00000000-0000-0000-0000-000000000004') then
        raise exception 'expired batch id was not pruned';
    end if;
end;
$$;

rollback;
\echo increment_message_counts: ok
