-- Checks increment_reactions (idempotent per batch, keeps a known emoji name) and that the
-- most-reacted-to list leaves out hidden members, which the bot's unit tests cannot reach.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/emoji_reactions.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into public.members (user_id, display_name, hidden) values
    ('t-shown', 'Shown', false),
    ('t-hidden', 'Hidden', true);

select public.increment_reactions(
    '00000000-0000-0000-0000-000000000021',
    '[{"emoji_key": "👍", "emoji_id": null, "name": "👍", "animated": false},
      {"emoji_key": "111", "emoji_id": "111", "name": "pog", "animated": true}]',
    '[{"emoji_key": "👍", "day": "2026-10-17", "count": 2},
      {"emoji_key": "111", "day": "2026-10-17", "count": 5}]',
    '[{"user_id": "t-shown", "day": "2026-10-17", "count": 1},
      {"user_id": "t-hidden", "day": "2026-10-17", "count": 100}]'
);
-- A retry of the same batch must change nothing.
select public.increment_reactions(
    '00000000-0000-0000-0000-000000000021',
    '[]', '[{"emoji_key": "111", "day": "2026-10-17", "count": 5}]', '[]'
);
-- A later batch without the custom emoji's name must keep the known one.
select public.increment_reactions(
    '00000000-0000-0000-0000-000000000022',
    '[{"emoji_key": "111", "emoji_id": "111", "name": null, "animated": true}]',
    '[{"emoji_key": "111", "day": "2026-10-18", "count": 1}]',
    '[]'
);

set local role anon;

do $$
begin
    if (select array_agg(emoji_key order by reaction_count desc) from public.top_emoji(null, 10))
        <> array['111', '👍'] then
        raise exception 'top emoji are wrong';
    end if;
    if (select reaction_count from public.top_emoji(null, 10) where emoji_key = '111')
        is distinct from 6::bigint then
        raise exception 'emoji counts wrong after a replayed batch';
    end if;
    if (select name from public.top_emoji(null, 10) where emoji_key = '111') is distinct from 'pog' then
        raise exception 'a missing name overwrote the known one';
    end if;
    if (select reaction_count from public.top_emoji('2026-10-18', 10) where emoji_key = '111')
        is distinct from 1::bigint then
        raise exception 'top_emoji ignores since';
    end if;

    if exists (select from public.most_reacted_members(null, 1000) where user_id = 't-hidden') then
        raise exception 'hidden member is on the most reacted-to list';
    end if;
    if (select reaction_count from public.most_reacted_members(null, 1000) where user_id = 't-shown')
        is distinct from 1::bigint then
        raise exception 'visible member is missing or miscounted';
    end if;
    if exists (select from public.reactions_received where user_id = 't-hidden') then
        raise exception 'anon can read the hidden member''s received reactions';
    end if;
end;
$$;

reset role;
rollback;
\echo emoji_reactions: ok
