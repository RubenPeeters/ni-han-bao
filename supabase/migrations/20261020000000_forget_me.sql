-- /forget-me (#72): delete everything stored about a Discord user, in every server, and
-- keep them out afterwards until they run /show-me.
-- Additive only: the previous release keeps working against it.

-- Who asked to be forgotten, as a hash: the only thing kept about them. Not per server
-- (forgetting covers every server), so no guild_id. RLS on and no policies: only the bot,
-- with the secret key, reads or writes it.
create table if not exists public.forgotten_users (
    user_hash text primary key,
    forgotten_at timestamptz not null default now()
);

alter table public.forgotten_users enable row level security;

create or replace function public.user_hash(member text)
returns text
language sql
immutable
set search_path = ''
as $$
    select encode(sha256(convert_to(member, 'UTF8')), 'hex');
$$;

-- Per-user advisory lock: writes take it shared, forget_user exclusive, so a write that
-- overlaps a deletion waits for its commit and then sees the marker. Volatile on purpose:
-- in read committed the check after the lock gets a fresh snapshot.
create or replace function public.lock_user(member text, exclusive boolean)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
    if exclusive then
        perform pg_catalog.pg_advisory_xact_lock(72, pg_catalog.hashtext(member));
    else
        perform pg_catalog.pg_advisory_xact_lock_shared(72, pg_catalog.hashtext(member));
    end if;
end;
$$;

-- Drops the row instead of failing, so a batch that still holds a forgotten user's counts
-- (buffered in the bot before /forget-me, or a history backfill) writes everyone else's.
create or replace function public.skip_forgotten()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    perform public.lock_user(new.user_id, false);
    if exists (select from public.forgotten_users f where f.user_hash = public.user_hash(new.user_id)) then
        return null;
    end if;
    return new;
end;
$$;

-- Every table with a user_id column. bot/src/forget.test.ts fails when a migration adds
-- one without this trigger.
create trigger skip_forgotten before insert on public.members
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.message_counts
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.reactions_received
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.voice_seconds
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.guild_members
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.member_channel_counts
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.member_emoji_counts
    for each row execute function public.skip_forgotten();

-- Records the user, then deletes their rows from every public table with a user_id column,
-- found in the catalog so a new per-user table is covered without changing this. In one
-- transaction: either everything is gone, or nothing changed. members goes last because
-- the per-member counts reference it.
create or replace function public.forget_user(member text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare t text;
begin
    perform public.lock_user(member, true);
    insert into public.forgotten_users (user_hash) values (public.user_hash(member))
    on conflict (user_hash) do nothing;
    for t in
        select c.relname::text
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'user_id' and not a.attisdropped
        order by c.relname = 'members', c.relname
    loop
        execute format('delete from public.%I where user_id = $1', t) using member;
    end loop;
end;
$$;

-- /show-me: counting starts again from the next event.
create or replace function public.remember_user(member text)
returns void
language sql
security invoker
set search_path = ''
as $$
    delete from public.forgotten_users where user_hash = public.user_hash(member);
$$;

revoke execute on function public.lock_user(text, boolean) from public, anon, authenticated;
revoke execute on function public.forget_user(text) from public, anon, authenticated;
revoke execute on function public.remember_user(text) from public, anon, authenticated;
grant execute on function public.lock_user(text, boolean) to service_role;
grant execute on function public.forget_user(text) to service_role;
grant execute on function public.remember_user(text) to service_role;
