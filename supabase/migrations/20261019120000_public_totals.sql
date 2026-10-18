-- Multi-server, part 4: the logged-out home page shows totals across every server, and the
-- server picker lists the logged-in visitor's servers. Additive: no table changes.

-- Totals only, no names and nothing per server or per person. Security definer so the home
-- page keeps working once part 5 closes the per-server tables to anon. Hidden members count
-- here like in message_total: they are never shown individually. A member of several servers
-- counts once. The bot's heartbeat is the newest one: a single bot writes one row per server.
create or replace function public.public_totals(since date)
returns table (
    servers bigint,
    members bigint,
    messages_since bigint,
    active_since bigint,
    bot_last_seen timestamptz,
    bot_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select count(*) from public.guilds),
        (select count(distinct m.user_id) from public.guild_members m),
        (select coalesce(sum(c.count), 0)::bigint from public.message_counts c where c.day >= since),
        (select count(distinct c.user_id) from public.message_counts c where c.day >= since and c.count > 0),
        (select max(b.last_seen) from public.bot_status b),
        (select b.avatar_url from public.bot_status b order by b.last_seen desc limit 1);
$$;

revoke execute on function public.public_totals(date) from public;
grant execute on function public.public_totals(date) to anon, authenticated, service_role;

-- The logged-in visitor's servers, by name; empty for anon. Security invoker: it reads only
-- the visitor's own rows, so it runs under whatever RLS part 5 puts on these tables.
create or replace function public.my_guilds()
returns table (guild_id text, name text, icon_url text)
language sql
stable
security invoker
set search_path = ''
as $$
    select g.guild_id, g.name, g.icon_url
    from public.guilds g
    join public.guild_members m on m.guild_id = g.guild_id
    where m.user_id = public.current_discord_id()
    order by g.name, g.guild_id;
$$;

grant execute on function public.my_guilds() to anon, authenticated;
