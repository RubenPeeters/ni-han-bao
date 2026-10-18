-- Checks current_discord_id() and is_guild_member() for a logged-in visitor and for anon.
-- Run against a local database with the migrations applied:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/guild_membership.sql
-- Everything happens in one transaction that is rolled back, so it leaves no rows behind.
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into auth.identities (user_id, provider, provider_id, identity_data) values
    ('00000000-0000-0000-0000-0000000000a1', 'discord', 't-discord', '{"sub": "t-discord"}');
insert into public.guild_members (guild_id, user_id) values ('t-guild', 't-discord');

set local role authenticated;
-- A forged user_metadata id must not count: only the stored identity does.
set local request.jwt.claims =
    '{"sub": "00000000-0000-0000-0000-0000000000a1", "user_metadata": {"provider_id": "t-other"}}';

do $$
begin
    if public.current_discord_id() is distinct from 't-discord' then
        raise exception 'current_discord_id() is %, expected t-discord', public.current_discord_id();
    end if;
    if not public.is_guild_member('t-guild') then
        raise exception 'member is not recognised as a member';
    end if;
    if public.is_guild_member('t-elsewhere') then
        raise exception 'member is a member of a server they are not in';
    end if;
end;
$$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

do $$
begin
    if public.current_discord_id() is not null or public.is_guild_member('t-guild') then
        raise exception 'anon is treated as a member';
    end if;
end;
$$;

reset role;
rollback;
