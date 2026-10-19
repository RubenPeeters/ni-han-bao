-- Riftbound collection (#150): which cards each member owns, what they trade and what they
-- lend. Per user, not per server (one binder across servers), so no guild_id: who may read it
-- follows the owner's profile (can_see_profile()). Additive only.

-- No row: does not own it. A printing with copies owned cannot be deleted from the catalogue
-- (no cascade): replacing the placeholders must move or drop collections on purpose.
create table if not exists public.riftbound_collection (
    user_id text not null,
    printing_id text not null references public.riftbound_printings (id),
    -- Not in Riot's data: the owner says so.
    finish text not null default 'normal' check (finish in ('normal', 'foil')),
    condition text not null default 'NM' check (condition in ('NM', 'LP', 'MP', 'HP')),
    quantity integer not null check (quantity between 1 and 999),
    for_trade integer not null default 0 check (for_trade between 0 and quantity),
    -- Copies on offer to borrow. Null: the owner's default (riftbound_lending.lend_default).
    lendable integer check (lendable between 0 and quantity),
    updated_at timestamptz not null default now(),
    primary key (user_id, printing_id, finish, condition)
);

create index if not exists riftbound_collection_printing on public.riftbound_collection (printing_id);

-- "I lend cards", off by default. lend_default is null until the owner has picked one:
-- 'nothing' (per-card counts only) or 'everything' (every copy, unless a card says less).
create table if not exists public.riftbound_lending (
    user_id text primary key,
    lends boolean not null default false,
    lend_default text check (lend_default in ('nothing', 'everything')),
    updated_at timestamptz not null default now()
);

alter table public.riftbound_collection enable row level security;
alter table public.riftbound_lending enable row level security;

create trigger skip_forgotten before insert on public.riftbound_collection
    for each row execute function public.skip_forgotten();
create trigger skip_forgotten before insert on public.riftbound_lending
    for each row execute function public.skip_forgotten();

-- A collection is part of the profile: private, members or public, and never while hidden.
create policy "visible profiles" on public.riftbound_collection for select to authenticated
    using (public.can_see_profile(user_id));
-- Your own setting only; others see its effect through riftbound_lenders().
create policy "own setting" on public.riftbound_lending for select to authenticated
    using (user_id = public.current_discord_id());

-- The site's steppers: absolute values, so a retried request cannot add a copy twice. 0 copies
-- deletes the row; trade and lend counts are capped at the copies owned.
create or replace function public.riftbound_collection_set(
    printing text, finish text, condition text, quantity integer, for_trade integer, lendable integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id();
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    if quantity <= 0 then
        delete from public.riftbound_collection c
        where c.user_id = me and c.printing_id = printing and c.finish = $2 and c.condition = $3;
        return;
    end if;
    insert into public.riftbound_collection as c (user_id, printing_id, finish, condition, quantity, for_trade, lendable)
    -- least() and greatest() skip nulls, so a null lendable needs the case to stay null.
    values (me, printing, finish, condition, quantity, least(greatest(for_trade, 0), quantity),
        case when lendable is not null then least(greatest(lendable, 0), quantity) end)
    -- By name: the parameters share the columns' names, which a column list would make ambiguous.
    on conflict on constraint riftbound_collection_pkey do update
    set quantity = excluded.quantity, for_trade = excluded.for_trade, lendable = excluded.lendable, updated_at = now();
    -- skip_forgotten() drops the row silently; say so instead of reporting a save.
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

-- "I own a full playset of this set": three of every card, one of a legend (a deck has one),
-- as normal near mint copies. Never lowers a count already there.
create or replace function public.riftbound_playset(set_code text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); n integer;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    insert into public.riftbound_collection as c (user_id, printing_id, quantity)
    select me, p.id, case when k.type = 'Legend' then 1 else 3 end
    from public.riftbound_printings p
    join public.riftbound_cards k on k.id = p.card_id
    where p.set_code = $1
    on conflict (user_id, printing_id, finish, condition) do update
    set quantity = greatest(c.quantity, excluded.quantity), updated_at = now();
    get diagnostics n = row_count;
    return n;
end;
$$;

-- The profile's lending form. A null default keeps the one picked before.
create or replace function public.riftbound_set_lending(lends boolean, lend_default text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id();
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    insert into public.riftbound_lending as l (user_id, lends, lend_default) values (me, lends, lend_default)
    on conflict (user_id) do update
    set lends = excluded.lends, lend_default = coalesce(excluded.lend_default, l.lend_default), updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

-- /collection add: the bot adds copies for the member who ran it. Returns the new count, or
-- null for a forgotten member (skip_forgotten()).
create or replace function public.riftbound_collection_add(member text, printing text, n integer)
returns integer
language sql
volatile
set search_path = ''
as $$
    insert into public.riftbound_collection as c (user_id, printing_id, quantity)
    values (member, printing, least(n, 999))
    on conflict (user_id, printing_id, finish, condition) do update
    set quantity = least(c.quantity + excluded.quantity, 999), updated_at = now()
    returning quantity;
$$;

-- Copies on offer: none unless the owner lends cards; then the card's own count, else all or
-- none by their default. shortcut: decks marked not for lending do not exist yet; subtract their cards here when they do.
create or replace function public.riftbound_available(c public.riftbound_collection, l public.riftbound_lending)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case when not coalesce(l.lends, false) then 0
        else coalesce(c.lendable, case when l.lend_default = 'everything' then c.quantity else 0 end) end;
$$;

-- Who has it? People who share a server with the visitor and have copies of `card` on offer,
-- with how many. can_see_profile() keeps out private profiles and hidden members. Security
-- definer to read other people's lending settings.
create or replace function public.riftbound_lenders(card text)
returns table (user_id text, display_name text, avatar_url text, copies bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select c.user_id, latest.display_name, latest.avatar_url, sum(public.riftbound_available(c, l))
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id and p.card_id = card
    join public.riftbound_lending l on l.user_id = c.user_id
    cross join lateral (
        select m.display_name, m.avatar_url from public.members m
        where m.user_id = c.user_id
        order by m.updated_at desc
        limit 1
    ) latest
    where c.user_id <> public.current_discord_id()
        and exists (
            select from public.guild_members a
            join public.guild_members b on b.guild_id = a.guild_id
            where a.user_id = c.user_id and b.user_id = public.current_discord_id()
        )
        and public.can_see_profile(c.user_id)
    group by c.user_id, latest.display_name, latest.avatar_url
    having sum(public.riftbound_available(c, l)) > 0
    order by 4 desc, 2;
$$;

-- The profile's Collection tab: totals per set and rarity. Security invoker: the table's
-- policy decides whose collection the visitor may read.
create or replace function public.profile_collection(u text)
returns table (set_code text, rarity text, cards bigint, copies bigint)
language sql
stable
set search_path = ''
as $$
    select p.set_code, coalesce(p.rarity, '-'), count(distinct p.id), sum(c.quantity)
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    where c.user_id = u
    group by 1, 2
    order by 1, 2;
$$;

revoke execute on function public.riftbound_collection_set(text, text, text, integer, integer, integer) from public, anon;
revoke execute on function public.riftbound_playset(text) from public, anon;
revoke execute on function public.riftbound_set_lending(boolean, text) from public, anon;
revoke execute on function public.riftbound_collection_add(text, text, integer) from public, anon, authenticated;
revoke execute on function public.riftbound_lenders(text) from public, anon;
revoke execute on function public.profile_collection(text) from public, anon;
grant execute on function public.riftbound_collection_set(text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.riftbound_playset(text) to authenticated;
grant execute on function public.riftbound_set_lending(boolean, text) to authenticated;
grant execute on function public.riftbound_collection_add(text, text, integer) to service_role;
grant execute on function public.riftbound_lenders(text) to authenticated;
grant execute on function public.profile_collection(text) to authenticated;
