-- A server's data is deleted 30 days after the bot leaves it (#351). Additive: the previous
-- release keeps working against it (its GuildDelete still deletes the guilds row).

-- When the bot left the server; null while it is in it. The bot clears it when it is added again.
alter table public.guilds add column if not exists left_at timestamptz;

-- Servers left before this release lost their guilds row but kept their data. bot_status
-- keeps a row for every server the bot ever saw, so they get their row back here, and the
-- bot's startup check then marks them left as of that check.
insert into public.guilds (guild_id, name)
select b.guild_id, b.guild_name from public.bot_status b
on conflict (guild_id) do nothing;

-- As in 20261020180000_guild_settings.sql, counting only the servers the bot is in.
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
    with opted_out as (
        select s.guild_id from public.guild_settings s where s.public_totals_opt_out
    )
    select
        (select count(*) from public.guilds g
            where g.left_at is null and g.guild_id not in (select guild_id from opted_out)),
        (select count(distinct m.user_id) from public.guild_members m
            where m.guild_id not in (select guild_id from opted_out)),
        (select coalesce(sum(c.count), 0)::bigint from public.message_counts c
            where c.day >= since and c.guild_id not in (select guild_id from opted_out)),
        (select count(distinct c.user_id) from public.message_counts c
            where c.day >= since and c.count > 0 and c.guild_id not in (select guild_id from opted_out)),
        (select max(b.last_seen) from public.bot_status b),
        (select b.avatar_url from public.bot_status b order by b.last_seen desc limit 1);
$$;

-- Deletes everything stored for one server the bot left more than 30 days ago: its rows in
-- every public table with a guild_id column, found in the catalog so a new per-server table
-- is covered without changing this. One call, one transaction: a failure leaves the server
-- whole. Returns whether it deleted; false for a server still in its 30 days or back.
-- Per-person data (profiles, collections, decks, loans, ...) has no guild_id and stays.
create or replace function public.forget_guild(guild text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare t text;
begin
    -- The lock makes a concurrent re-add (the bot's upsert clearing left_at) wait for this.
    perform from public.guilds g
    where g.guild_id = guild and g.left_at < now() - interval '30 days'
    for update;
    if not found then
        return false;
    end if;
    -- The per-member counts reference members, channels and emojis; guilds goes last.
    for t in
        select c.relname::text
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'guild_id' and not a.attisdropped
        order by c.relname = 'guilds', c.relname in ('members', 'channels', 'emojis'), c.relname
    loop
        execute format('delete from public.%I where guild_id = $1', t) using guild;
    end loop;
    return true;
end;
$$;

revoke execute on function public.forget_guild(text) from public, anon, authenticated;
grant execute on function public.forget_guild(text) to service_role;
