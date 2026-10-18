-- Checks report_card: hidden members never reach the public Discord post, the [since, until)
-- window on both its edges, and the shape of an empty week, which the bot's unit tests cannot reach.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/report_card.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

-- A non-UTC session must not shift the channel hour window.
set local timezone = 'Europe/Brussels';

insert into public.members (user_id, display_name, hidden) values
    ('t-shown', 'Shown', false),
    ('t-hidden', 'Hidden', true);
insert into public.message_counts (user_id, day, count) values
    ('t-shown', '2026-10-12', 1),    -- first day: in
    ('t-shown', '2026-10-18', 2),    -- last day: in
    ('t-shown', '2026-10-11', 100),  -- day before: out
    ('t-shown', '2026-10-19', 100),  -- `until`: out
    ('t-hidden', '2026-10-14', 500); -- top talker, but hidden
insert into public.channels (channel_id, name) values ('c1', 'general'), ('c2', 'memes');
insert into public.channel_message_counts (channel_id, hour, count) values
    ('c1', '2026-10-12T00:00:00Z', 2),
    ('c1', '2026-10-18T23:00:00Z', 2),
    ('c2', '2026-10-11T23:00:00Z', 100),
    ('c2', '2026-10-19T00:00:00Z', 100);
insert into public.emojis (emoji_key, emoji_id, name) values ('👍', null, '👍');
insert into public.emoji_counts (emoji_key, day, count) values ('👍', '2026-10-13', 3), ('👍', '2026-10-19', 9);
insert into public.member_flow (day, joins, leaves) values
    ('2026-10-12', 2, 1), ('2026-10-18', 1, 0), ('2026-10-19', 50, 50);

-- The bot's role: it bypasses RLS, so the function itself must leave hidden members out.
set local role service_role;

do $$
declare
    r jsonb := public.report_card('2026-10-12', '2026-10-19');
    empty jsonb := public.report_card('2026-01-05', '2026-01-12');
begin
    if r->'top_talkers' <> '[{"display_name": "Shown", "message_count": 3}]'::jsonb then
        raise exception 'top talkers wrong (hidden member or window edges): %', r->'top_talkers';
    end if;
    if r->'busiest_channel' <> '{"name": "general", "message_count": 4}'::jsonb then
        raise exception 'busiest channel wrong: %', r->'busiest_channel';
    end if;
    if (r->'top_emoji'->>'reaction_count')::int <> 3 then
        raise exception 'top emoji wrong: %', r->'top_emoji';
    end if;
    if (r->>'joins')::int <> 3 or (r->>'leaves')::int <> 1 then
        raise exception 'member flow wrong: % / %', r->'joins', r->'leaves';
    end if;

    if empty <> '{"top_talkers": [], "busiest_channel": null, "top_emoji": null, "joins": 0, "leaves": 0}'::jsonb then
        raise exception 'empty week has the wrong shape: %', empty;
    end if;
end;
$$;

reset role;
rollback;
\echo report_card: ok
