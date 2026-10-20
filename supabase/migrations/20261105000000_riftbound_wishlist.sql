-- Riftbound wishlist (#177): what a member wants, from cards they add by hand and from what
-- their decks need. Derived when read, never stored. Per user like the collection, so no
-- guild_id. Additive: save_riftbound_deck() gains a parameter with a default, so its callers
-- keep working.

-- How a deck counts: 'shared' decks lend each other cards (the largest need among them),
-- 'dedicated' ones stay built (their needs add up).
alter table public.riftbound_decks add column if not exists wishlist_mode text not null default 'none'
    check (wishlist_mode in ('none', 'shared', 'dedicated'));
-- The member's answer, preset on their new decks. Null: not asked yet.
alter table public.profiles add column if not exists wishlist_mode text
    check (wishlist_mode in ('none', 'shared', 'dedicated'));

-- Cards added by hand, with how many the member wants in all; with a printing, only that one.
create table if not exists public.riftbound_wishlist (
    user_id text not null,
    -- No cascade: replacing the catalogue must not delete anyone's wishlist.
    card_id text not null references public.riftbound_cards (id),
    printing_id text,
    quantity integer not null check (quantity between 1 and 99),
    updated_at timestamptz not null default now(),
    foreign key (printing_id, card_id) references public.riftbound_printings (id, card_id),
    unique nulls not distinct (user_id, card_id, printing_id)
);

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.riftbound_wishlist
    for each row execute function public.skip_forgotten();

-- Your own rows only; everyone else's through profile_wishlist(). Only functions write.
alter table public.riftbound_wishlist enable row level security;
create policy "own rows" on public.riftbound_wishlist for select to authenticated
    using (user_id = public.current_discord_id());

-- The wishlist page's entries: the caller's own, as an absolute count. 0 deletes it.
create or replace function public.set_riftbound_wish(p_card text, p_printing text, p_quantity integer)
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
        delete from public.riftbound_wishlist
        where user_id = me and card_id = p_card and printing_id is not distinct from p_printing;
        return;
    end if;
    insert into public.riftbound_wishlist (user_id, card_id, printing_id, quantity)
    values (me, p_card, p_printing, least(p_quantity, 99))
    on conflict (user_id, card_id, printing_id) do update set quantity = excluded.quantity, updated_at = now();
    -- skip_forgotten() drops the row silently; say so instead of reporting a save.
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_riftbound_wish(text, text, integer) from public, anon;
grant execute on function public.set_riftbound_wish(text, text, integer) to authenticated;

-- The question on the Decks and Wishlist pages: the caller's own default.
create or replace function public.set_wishlist_mode(p_mode text)
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
    insert into public.profiles (user_id, wishlist_mode) values (me, p_mode)
    on conflict (user_id) do update set wishlist_mode = excluded.wishlist_mode, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_wishlist_mode(text) from public, anon;
grant execute on function public.set_wishlist_mode(text) to authenticated;

-- The profile's Wishlist tab, for whoever may see the profile (can_see_profile()): per card,
-- printing pin and language (null: any) how many the decks need and the hand-set target, with
-- u's copies of the card. Dedicated decks add up into one row (deck null); each shared deck keeps
-- its own row, since its copies may move to another shared deck: deck numbers it per card only,
-- so no deck is followed across cards. What is still wanted is wishlist() in lib/wishlist.ts.
create or replace function public.profile_wishlist(u text)
returns table (card_id text, printing_id text, language text, deck integer, decks integer, manual integer, copies jsonb)
language sql
stable
security definer
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
    wants as (
        select w.card_id, w.printing_id, w.language, null::integer as deck, sum(w.q)::integer as decks, null::integer as manual
        from per_deck w
        where w.wishlist_mode = 'dedicated'
        group by w.card_id, w.printing_id, w.language
        union all
        select w.card_id, w.printing_id, w.language, dense_rank() over (partition by w.card_id order by w.id)::integer,
            w.q::integer, null
        from per_deck w
        where w.wishlist_mode = 'shared'
        union all
        select w.card_id, w.printing_id, null, null, 0, w.quantity from public.riftbound_wishlist w where w.user_id = u
    )
    select w.card_id, w.printing_id, w.language, w.deck, max(w.decks)::integer, max(w.manual)::integer,
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
    where public.can_see_profile(u)
    group by w.card_id, w.printing_id, w.language, w.deck
    order by w.card_id, w.deck nulls first, w.printing_id nulls last, w.language nulls last;
$$;

revoke execute on function public.profile_wishlist(text) from public;
grant execute on function public.profile_wishlist(text) to anon, authenticated;

-- As in 20261104000000_riftbound_deck_versions.sql, plus the wishlist mode: a new deck takes
-- the member's default, a null keeps the deck's (Restore and old callers pass none).
drop function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb);
create function public.save_riftbound_deck(
    p_deck uuid, p_name text, p_legend text, p_champion text, p_notes text, p_visibility text,
    p_language text, p_allow_other_languages boolean, p_entries jsonb, p_wishlist_mode text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); deck uuid;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    if p_deck is null then
        insert into public.riftbound_decks (user_id, name, legend_id, champion_id, notes, visibility, language,
            allow_other_languages, wishlist_mode)
        values (me, p_name, p_legend, p_champion, coalesce(p_notes, ''), coalesce(p_visibility, 'private'),
            coalesce(p_language, 'en'), coalesce(p_allow_other_languages, true),
            coalesce(p_wishlist_mode, (select p.wishlist_mode from public.profiles p where p.user_id = me), 'none'))
        returning id into deck;
        -- skip_forgotten() drops the row silently; say so instead of reporting a save.
        if deck is null then
            raise exception 'you asked to be forgotten: use /show-me in Discord first';
        end if;
    else
        update public.riftbound_decks set name = p_name, legend_id = p_legend, champion_id = p_champion,
            notes = coalesce(p_notes, ''), visibility = p_visibility, language = p_language,
            allow_other_languages = p_allow_other_languages, wishlist_mode = coalesce(p_wishlist_mode, wishlist_mode),
            updated_at = now()
        where id = p_deck and user_id = me
        returning id into deck;
        if deck is null then
            raise exception 'not your deck';
        end if;
        delete from public.riftbound_deck_cards where deck_id = deck;
    end if;
    -- The same card twice in a section (two pasted lines) is one entry.
    insert into public.riftbound_deck_cards (deck_id, section, card_id, printing_id, quantity)
    select deck, e.section, e.card_id, e.printing_id, sum(e.quantity)
    from jsonb_to_recordset(coalesce(p_entries, '[]')) e (section text, card_id text, printing_id text, quantity integer)
    where e.quantity > 0
    group by e.section, e.card_id, e.printing_id;
    perform public.snapshot_riftbound_deck(deck);
    return deck;
end;
$$;

revoke execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text) from public, anon;
grant execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb, text) to authenticated;
