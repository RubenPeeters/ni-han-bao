-- Riftbound wishlist (#330): a playset goal per set, below what the decks need. Stored as the
-- sets chosen, never a row per card: the cards it wants are worked out when read, like the rest
-- of the wishlist. Not backwards compatible: riftbound_wish_rows() and profile_wishlist() gain a
-- column, so they are dropped and made again; the site and bot reading it ship with it.

-- "All sets", chosen as a whole: every set, also the ones Riot has not released yet.
alter table public.profiles add column if not exists playset_all_sets boolean not null default false;

-- The sets chosen one by one. Per user like the wishlist, so no guild_id.
create table if not exists public.riftbound_playset_goals (
    user_id text not null,
    set_code text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, set_code)
);

create trigger skip_forgotten before insert on public.riftbound_playset_goals
    for each row execute function public.skip_forgotten();

-- Your own rows only; everyone else's goal through profile_wishlist(). Only functions write.
alter table public.riftbound_playset_goals enable row level security;
create policy "own rows" on public.riftbound_playset_goals for select to authenticated
    using (user_id = public.current_discord_id());

-- The Wishlist page's switches: one set on or off, or all sets (p_set null).
create or replace function public.set_riftbound_playset_goal(p_set text, p_on boolean)
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
    if p_set is null then
        insert into public.profiles (user_id, playset_all_sets) values (me, coalesce(p_on, false))
        on conflict (user_id) do update set playset_all_sets = excluded.playset_all_sets, updated_at = now();
        if not found then
            raise exception 'you asked to be forgotten: use /show-me in Discord first';
        end if;
        delete from public.riftbound_playset_goals where user_id = me;
        return;
    end if;
    if not exists (select from public.riftbound_printings p where p.set_code = p_set) then
        raise exception 'unknown set %', p_set;
    end if;
    if not coalesce(p_on, false) then
        -- One set off out of all of them: the others stay chosen, one by one, so new sets no longer count.
        if (select p.playset_all_sets from public.profiles p where p.user_id = me) then
            update public.profiles set playset_all_sets = false, updated_at = now() where user_id = me;
            insert into public.riftbound_playset_goals (user_id, set_code)
            select distinct me, p.set_code from public.riftbound_printings p where p.set_code <> p_set
            on conflict (user_id, set_code) do nothing;
        end if;
        delete from public.riftbound_playset_goals where user_id = me and set_code = p_set;
        return;
    end if;
    insert into public.riftbound_playset_goals (user_id, set_code) values (me, p_set)
    on conflict (user_id, set_code) do update set updated_at = now();
    -- skip_forgotten() drops the row silently; say so instead of reporting a save.
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_riftbound_playset_goal(text, boolean) from public, anon;
grant execute on function public.set_riftbound_playset_goal(text, boolean) to authenticated;

drop function public.profile_wishlist(text);
drop function public.riftbound_wish_rows(text);

-- As in 20261106000000_riftbound_trades.sql, plus the playset goal: `goal` is 3 on a row (any
-- printing, any language) for each card with a basic printing (isBasicPrinting(), as
-- own_riftbound_playset()) in a chosen set. Only cards u owns fewer than 3 of, so a full goal
-- the member nearly has is not hundreds of rows. wishlist() counts it after the decks and targets.
create function public.riftbound_wish_rows(u text)
returns table (card_id text, printing_id text, language text, deck integer, decks integer, manual integer, goal integer, copies jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
    with per_deck as (
        select d.id, d.wishlist_mode, x.card_id, x.printing_id,
            case when d.allow_other_languages then null else d.language::text end as language, sum(x.quantity) as q
        from public.riftbound_decks d
        cross join lateral (
            select c.card_id, c.printing_id, c.quantity from public.riftbound_deck_cards c where c.deck_id = d.id
            union all
            select d.legend_id, null, 1 where d.legend_id is not null
        ) x
        where d.user_id = u and d.wishlist_mode <> 'none'
        group by d.id, d.wishlist_mode, x.card_id, x.printing_id, 5
    ),
    goal as (
        select distinct p.card_id
        from public.riftbound_printings p
        where (p.set_code in (select g.set_code from public.riftbound_playset_goals g where g.user_id = u)
                or exists (select from public.profiles pr where pr.user_id = u and pr.playset_all_sets))
            and p.collector_number <= substring(p.collector_code from '^[^-]+-[0-9]+/([0-9]+)$')::integer
    ),
    owned as (
        select p.card_id, sum(c.quantity) as n
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        where c.user_id = u
        group by p.card_id
    ),
    wants as (
        select w.card_id, w.printing_id, w.language, null::integer as deck, sum(w.q)::integer as decks,
            null::integer as manual, null::integer as goal
        from per_deck w
        where w.wishlist_mode = 'dedicated'
        group by w.card_id, w.printing_id, w.language
        union all
        select w.card_id, w.printing_id, w.language, dense_rank() over (partition by w.card_id order by w.id)::integer,
            w.q::integer, null, null
        from per_deck w
        where w.wishlist_mode = 'shared'
        union all
        select w.card_id, w.printing_id, null, null, 0, w.quantity, null from public.riftbound_wishlist w where w.user_id = u
        union all
        select g.card_id, null, null, null, 0, null, 3
        from goal g
        left join owned o on o.card_id = g.card_id
        where coalesce(o.n, 0) < 3
    )
    select w.card_id, w.printing_id, w.language, w.deck, max(w.decks)::integer, max(w.manual)::integer, max(w.goal)::integer,
        coalesce((
            select jsonb_agg(jsonb_build_object('printing_id', o.printing_id, 'language', o.language, 'quantity', o.quantity))
            from (
                select c.printing_id, c.language::text as language, sum(c.quantity)::integer as quantity
                from public.riftbound_collection c
                join public.riftbound_printings p on p.id = c.printing_id
                where c.user_id = u and p.card_id = w.card_id
                group by c.printing_id, c.language
            ) o
        ), '[]')
    from wants w
    group by w.card_id, w.printing_id, w.language, w.deck
    order by w.card_id, w.deck nulls first, w.printing_id nulls last, w.language nulls last;
$$;

revoke execute on function public.riftbound_wish_rows(text) from public, anon, authenticated;
grant execute on function public.riftbound_wish_rows(text) to service_role;

create function public.profile_wishlist(u text)
returns table (card_id text, printing_id text, language text, deck integer, decks integer, manual integer, goal integer, copies jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select * from public.riftbound_wish_rows(u) where public.can_see_profile(u);
$$;

revoke execute on function public.profile_wishlist(text) from public;
grant execute on function public.profile_wishlist(text) to anon, authenticated;
