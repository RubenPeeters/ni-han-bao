-- Checks forget_guild() (#351): a server left 31 days ago is deleted from every per-server
-- table, one left 29 days ago and one the bot came back to are not, and per-person rows stay.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/forget_guild.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

do $$
declare g text; s bigint; e bigint;
begin
    foreach g in array array['r-old', 'r-recent', 'r-back'] loop
        insert into public.guilds (guild_id, name, left_at) values (g, g, case g
            when 'r-old' then now() - interval '31 days'
            when 'r-recent' then now() - interval '29 days'
        end);
        insert into public.bot_status (guild_id, guild_name, member_count) values (g, g, 1);
        insert into public.guild_settings (guild_id, report_channel_id) values (g, 'c');
        insert into public.members (guild_id, user_id, display_name) values (g, 'r-user', 'x');
        insert into public.channels (guild_id, channel_id, name) values (g, 'c', 'c');
        insert into public.emojis (guild_id, emoji_key, name) values (g, 'e', 'e');
        insert into public.message_counts (guild_id, user_id, day, count) values (g, 'r-user', '2026-01-01', 1);
        insert into public.member_channel_counts (guild_id, user_id, channel_id, day, count)
        values (g, 'r-user', 'c', '2026-01-01', 1);
        insert into public.member_emoji_counts (guild_id, user_id, emoji_key, day, count)
        values (g, 'r-user', 'e', '2026-01-01', 1);
        insert into public.stores (guild_id, name, city, added_by) values (g, 's', 'c', 'r-user') returning id into s;
        insert into public.events (guild_id, store_id, starts_at) values (g, s, now()) returning id into e;
        insert into public.event_attendees (guild_id, event_id, user_id) values (g, e, 'r-user');
    end loop;
    insert into public.profiles (user_id, visibility) values ('r-user', 'private');
end;
$$;

-- As the bot: the function is the secret key's only.
set local role service_role;

do $$
declare t text; n bigint; g text;
begin
    if not public.forget_guild('r-old') then
        raise exception 'a server left 31 days ago is not deleted';
    end if;
    if public.forget_guild('r-recent') or public.forget_guild('r-back') or public.forget_guild('r-unknown') then
        raise exception 'a server within its 30 days, back, or unknown is deleted';
    end if;
    -- Every per-server table: nothing left of r-old, the others whole.
    for t in
        select c.relname::text
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind = 'r' and a.attname = 'guild_id' and not a.attisdropped
    loop
        foreach g in array array['r-old', 'r-recent', 'r-back'] loop
            execute format('select count(*) from public.%I where guild_id = $1', t) using g into n;
            if (g = 'r-old') <> (n = 0) and t in ('guilds', 'bot_status', 'guild_settings', 'members',
                'channels', 'emojis', 'message_counts', 'member_channel_counts', 'member_emoji_counts',
                'stores', 'events', 'event_attendees') then
                raise exception '% has % rows of %', t, n, g;
            end if;
            if g = 'r-old' and n > 0 then
                raise exception '% still has rows of r-old', t;
            end if;
        end loop;
    end loop;
    if not exists (select from public.profiles where user_id = 'r-user') then
        raise exception 'a per-person row was deleted';
    end if;
end;
$$;

reset role;
set local role authenticated;

do $$
begin
    perform public.forget_guild('r-recent');
    raise exception 'a logged-in visitor can run forget_guild()';
exception when insufficient_privilege then
    null;
end;
$$;

rollback;
