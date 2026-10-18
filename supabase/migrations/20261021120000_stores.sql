-- Local game stores per server (#114): /store add, /store mine, and the "Where we play" page.
-- Additive only: the previous release keeps working against it.

create table if not exists public.stores (
    id bigint generated always as identity primary key,
    guild_id text not null,
    -- Stores work for any game; Riftbound is what the servers play now.
    game text not null default 'Riftbound',
    name text not null,
    -- Members are placed by store or city only, never by address.
    city text not null,
    url text,
    -- Who may /store remove it besides Manage Server; nulled by forget_user().
    added_by text,
    created_at timestamptz not null default now(),
    unique (guild_id, game, name, city)
);

alter table public.stores enable row level security;

create policy "members read" on public.stores for select to authenticated
    using (public.is_guild_member(guild_id));

create table if not exists public.store_regulars (
    guild_id text not null,
    store_id bigint not null references public.stores (id) on delete cascade,
    user_id text not null,
    created_at timestamptz not null default now(),
    primary key (store_id, user_id)
);

alter table public.store_regulars enable row level security;

-- Security definer because the members policy hides hidden rows, so a policy subquery
-- could never find them. Answers only for servers the caller is a member of.
create or replace function public.is_hidden_member(g text, member text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_guild_member(g) and exists (
        select from public.members m where m.guild_id = g and m.user_id = member and m.hidden
    );
$$;

revoke execute on function public.is_hidden_member(text, text) from public;
grant execute on function public.is_hidden_member(text, text) to authenticated, service_role;

-- Opt-out: a member hidden in this server is not counted. Members without a members row
-- (never posted) are not hidden, so they count.
create policy "members read" on public.store_regulars for select to authenticated using (
    public.is_guild_member(guild_id) and not public.is_hidden_member(guild_id, user_id)
);

-- Regulars per store, counted in the database: one row per regular would hit PostgREST's
-- row limit. Security invoker, so the policy above leaves out hidden members.
create or replace function public.store_regular_counts(guild text)
returns table (store_id bigint, regulars bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select r.store_id, count(*) from public.store_regulars r where r.guild_id = guild group by r.store_id;
$$;

grant execute on function public.store_regular_counts(text) to authenticated;

create trigger skip_forgotten before insert on public.store_regulars
    for each row execute function public.skip_forgotten();

-- Same as before, plus: the stores a forgotten user added stay (the server still plays
-- there), without their id.
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
    update public.stores set added_by = null where added_by = member;
end;
$$;
