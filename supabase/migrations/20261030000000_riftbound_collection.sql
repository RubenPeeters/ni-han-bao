-- Riftbound collection (#150): which cards each member owns, how many are for trade and how
-- many they lend, and the "I lend cards" opt-in. Additive only.

-- The opt-in, on the profile it follows. Off: nothing of theirs is lendable, whatever the
-- per-card counts say. lend_all is the default a card without its own count follows.
alter table public.profiles add column if not exists lends_cards boolean not null default false;
alter table public.profiles add column if not exists lend_all boolean not null default false;

-- Per user, not per server (one binder across servers), so no guild_id. Finish and condition
-- are the owner's word: Riot's data has neither.
create table if not exists public.riftbound_collection (
    user_id text not null,
    -- No cascade: replacing the catalogue must not delete what people own.
    printing_id text not null references public.riftbound_printings (id),
    finish text not null check (finish in ('normal', 'foil')),
    condition text not null check (condition in ('NM', 'LP', 'MP', 'HP')),
    quantity integer not null check (quantity > 0),
    for_trade integer not null default 0 check (for_trade between 0 and quantity),
    -- Null follows the owner's default (profiles.lend_all); a number overrides it.
    lendable integer check (lendable between 0 and quantity),
    updated_at timestamptz not null default now(),
    primary key (user_id, printing_id, finish, condition)
);

create index if not exists riftbound_collection_printing on public.riftbound_collection (printing_id);

-- Your own rows only; everyone else's through the functions below. Only functions write.
alter table public.riftbound_collection enable row level security;
create policy "own rows" on public.riftbound_collection for select to authenticated
    using (user_id = public.current_discord_id());

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.riftbound_collection
    for each row execute function public.skip_forgotten();

-- How many copies of a row its owner offers to lend: none unless they lend cards at all.
create or replace function public.riftbound_lendable(c public.riftbound_collection, p public.profiles)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case when coalesce(p.lends_cards, false)
        then least(c.quantity, coalesce(c.lendable, case when p.lend_all then c.quantity else 0 end))
        else 0 end;
$$;

-- The Cards grid's steppers: the caller's own row, as absolute numbers so a retried save
-- cannot count a tap twice. 0 copies deletes the row. Security definer: no write policies.
create or replace function public.set_riftbound_copies(
    p_printing text, p_finish text, p_condition text, p_quantity integer, p_for_trade integer, p_lendable integer
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
    if p_quantity <= 0 then
        delete from public.riftbound_collection
        where user_id = me and printing_id = p_printing and finish = p_finish and condition = p_condition;
        return;
    end if;
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, quantity, for_trade, lendable)
    values (me, p_printing, p_finish, p_condition, p_quantity,
        least(greatest(p_for_trade, 0), p_quantity),
        -- greatest() skips nulls, so keep null (follow the lending default) explicitly.
        case when p_lendable is not null then least(greatest(p_lendable, 0), p_quantity) end)
    on conflict (user_id, printing_id, finish, condition) do update set quantity = excluded.quantity,
        for_trade = excluded.for_trade, lendable = excluded.lendable, updated_at = now();
    -- skip_forgotten() drops the row silently; say so instead of reporting a save.
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_riftbound_copies(text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.set_riftbound_copies(text, text, text, integer, integer, integer) to authenticated;

-- "I own a playset of this set": every printing in it the caller has fewer than 3 copies of
-- (any finish or condition) is topped up to 3 with normal, NM copies. Returns how many changed.
create or replace function public.own_riftbound_playset(p_set text)
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
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, quantity)
    select me, p.id, 'normal', 'NM', 3 - coalesce(owned.n, 0)
    from public.riftbound_printings p
    left join lateral (
        select sum(c.quantity)::integer as n from public.riftbound_collection c
        where c.user_id = me and c.printing_id = p.id
    ) owned on true
    where p.set_code = p_set and coalesce(owned.n, 0) < 3
    on conflict (user_id, printing_id, finish, condition) do update
        set quantity = public.riftbound_collection.quantity + excluded.quantity, updated_at = now();
    get diagnostics n = row_count;
    return n;
end;
$$;

revoke execute on function public.own_riftbound_playset(text) from public, anon;
grant execute on function public.own_riftbound_playset(text) to authenticated;

-- The profile page's "I lend cards": the caller's own row only, like set_profile_visibility().
create or replace function public.set_card_lending(p_lends boolean, p_lend_all boolean)
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
    insert into public.profiles (user_id, lends_cards, lend_all) values (me, p_lends, p_lend_all)
    on conflict (user_id) do update
        set lends_cards = excluded.lends_cards, lend_all = excluded.lend_all, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_card_lending(boolean, boolean) from public, anon;
grant execute on function public.set_card_lending(boolean, boolean) to authenticated;

-- /collection add: the bot's quick entry, normal NM copies added to what is there. Returns the
-- new count, or null for a forgotten user (skip_forgotten() dropped the row).
create or replace function public.add_riftbound_copies(member text, p_printing text, n integer)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, quantity)
    values (member, p_printing, 'normal', 'NM', n)
    on conflict (user_id, printing_id, finish, condition) do update
        set quantity = public.riftbound_collection.quantity + excluded.quantity, updated_at = now()
    returning quantity;
$$;

revoke execute on function public.add_riftbound_copies(text, text, integer) from public, anon, authenticated;
grant execute on function public.add_riftbound_copies(text, text, integer) to service_role;

-- The profile's Collection tab: copies and distinct printings per set and rarity, for whoever
-- may see the profile (can_see_profile()).
create or replace function public.profile_collection(u text)
returns table (set_code text, rarity text, copies bigint, printings bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select p.set_code, coalesce(p.rarity, 'Unknown'), sum(c.quantity)::bigint, count(distinct p.id)
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    where c.user_id = u and public.can_see_profile(u)
    group by p.set_code, coalesce(p.rarity, 'Unknown')
    order by p.set_code, coalesce(p.rarity, 'Unknown');
$$;

revoke execute on function public.profile_collection(text) from public;
grant execute on function public.profile_collection(text) to anon, authenticated;

-- Who has it?: per server the visitor is in, the other members with copies of the card on
-- offer. Only those who lend cards, whose profile is not private and whom the visitor may
-- see (can_see_profile() also leaves out anyone hidden with /hide-me).
create or replace function public.card_lenders(p_card text)
returns table (guild_id text, guild_name text, user_id text, display_name text, avatar_url text, copies bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select g.guild_id, g.name, m.user_id, m.display_name, m.avatar_url, l.copies
    from public.guild_members b
    join public.guilds g on g.guild_id = b.guild_id
    join public.guild_members a on a.guild_id = b.guild_id and a.user_id <> b.user_id
    join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    join public.profiles pr on pr.user_id = a.user_id and pr.lends_cards and pr.visibility <> 'private'
    cross join lateral (
        select sum(public.riftbound_lendable(c, pr))::bigint as copies
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        where c.user_id = a.user_id and p.card_id = p_card
    ) l
    where b.user_id = public.current_discord_id() and l.copies > 0 and public.can_see_profile(a.user_id)
    order by g.name, l.copies desc, m.display_name;
$$;

revoke execute on function public.card_lenders(text) from public;
grant execute on function public.card_lenders(text) to authenticated;
