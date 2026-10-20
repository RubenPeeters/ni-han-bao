-- Riftbound decks (#173): a person's decks, their cards, and who may see them. Per user like
-- the collection, so no guild_id. Additive only.

-- So a deck entry can name a printing only of its own card (the foreign key below).
alter table public.riftbound_printings add constraint riftbound_printings_id_card unique (id, card_id);

create table if not exists public.riftbound_decks (
    -- Unguessable: a public deck is shared by its link.
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    name text not null check (char_length(name) between 1 and 100),
    -- No cascade: replacing the catalogue must not delete anyone's decks.
    legend_id text references public.riftbound_cards (id),
    champion_id text references public.riftbound_cards (id),
    notes text not null default '' check (char_length(notes) <= 2000),
    -- 'servers': members of a server the owner is in; 'public': anyone logged in with the link.
    visibility text not null default 'private' check (visibility in ('private', 'servers', 'public')),
    -- The language the deck is built in, and whether copies in other languages count for it.
    language public.riftbound_language not null default 'en',
    allow_other_languages boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists riftbound_decks_user on public.riftbound_decks (user_id);

-- An abstract card and how many; with a printing, only that printing satisfies the entry.
create table if not exists public.riftbound_deck_cards (
    deck_id uuid not null references public.riftbound_decks (id) on delete cascade,
    section text not null check (section in ('main', 'runes', 'battlefields', 'sideboard')),
    card_id text not null references public.riftbound_cards (id),
    printing_id text,
    quantity integer not null check (quantity between 1 and 99),
    foreign key (printing_id, card_id) references public.riftbound_printings (id, card_id),
    unique nulls not distinct (deck_id, section, card_id, printing_id)
);

-- forget_user() deletes the decks by their user_id column, and their cards by the cascade.
create trigger skip_forgotten before insert on public.riftbound_decks
    for each row execute function public.skip_forgotten();

-- Who may see a deck: its owner, anyone logged in for a public one, and for 'servers' whoever
-- shares a server with the owner. Security definer: guild_members is not readable directly.
create or replace function public.can_see_deck(owner text, visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(public.current_discord_id() = owner, false) or case visibility
        when 'public' then public.current_discord_id() is not null
        when 'servers' then exists (
            select from public.guild_members a
            join public.guild_members b on b.guild_id = a.guild_id
            where a.user_id = owner and b.user_id = public.current_discord_id()
        )
        else false
    end;
$$;

revoke execute on function public.can_see_deck(text, text) from public;
grant execute on function public.can_see_deck(text, text) to authenticated;

alter table public.riftbound_decks enable row level security;
alter table public.riftbound_deck_cards enable row level security;

create policy "visible decks" on public.riftbound_decks for select to authenticated
    using (public.can_see_deck(user_id, visibility));
-- The deck's own policy decides: the subquery reads riftbound_decks under it.
create policy "cards of visible decks" on public.riftbound_deck_cards for select to authenticated
    using (exists (select from public.riftbound_decks d where d.id = deck_id));

-- The deck editor's Save: the whole deck, its settings and every entry, in one go, so a retried
-- save cannot count anything twice. A null id makes a new deck. Returns the deck's id.
create or replace function public.save_riftbound_deck(
    p_deck uuid, p_name text, p_legend text, p_champion text, p_notes text, p_visibility text,
    p_language text, p_allow_other_languages boolean, p_entries jsonb
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
        insert into public.riftbound_decks (user_id, name, legend_id, champion_id, notes, visibility, language, allow_other_languages)
        values (me, p_name, p_legend, p_champion, coalesce(p_notes, ''), coalesce(p_visibility, 'private'),
            coalesce(p_language, 'en'), coalesce(p_allow_other_languages, true))
        returning id into deck;
        -- skip_forgotten() drops the row silently; say so instead of reporting a save.
        if deck is null then
            raise exception 'you asked to be forgotten: use /show-me in Discord first';
        end if;
    else
        update public.riftbound_decks set name = p_name, legend_id = p_legend, champion_id = p_champion,
            notes = coalesce(p_notes, ''), visibility = p_visibility, language = p_language,
            allow_other_languages = p_allow_other_languages, updated_at = now()
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
    return deck;
end;
$$;

revoke execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.save_riftbound_deck(uuid, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- Add to deck on the Cards grid and card page: a legend becomes the deck's legend, any other
-- card one more unpinned copy in the section its type goes in (as sectionFor() in lib/decks.ts).
create or replace function public.add_riftbound_deck_card(p_deck uuid, p_card text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); kind text;
begin
    if not exists (select from public.riftbound_decks d where d.id = p_deck and d.user_id = me) then
        raise exception 'not your deck';
    end if;
    select c.type into kind from public.riftbound_cards c where c.id = p_card;
    if kind is null then
        raise exception 'no such card';
    end if;
    if kind = 'Legend' then
        update public.riftbound_decks set legend_id = p_card, updated_at = now() where id = p_deck;
        return;
    end if;
    insert into public.riftbound_deck_cards (deck_id, section, card_id, quantity)
    values (p_deck, case kind when 'Rune' then 'runes' when 'Battlefield' then 'battlefields' else 'main' end, p_card, 1)
    on conflict (deck_id, section, card_id, printing_id)
        do update set quantity = least(public.riftbound_deck_cards.quantity + 1, 99);
    update public.riftbound_decks set updated_at = now() where id = p_deck;
end;
$$;

revoke execute on function public.add_riftbound_deck_card(uuid, text) from public, anon;
grant execute on function public.add_riftbound_deck_card(uuid, text) to authenticated;

create or replace function public.delete_riftbound_deck(p_deck uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
    delete from public.riftbound_decks where id = p_deck and user_id = public.current_discord_id();
$$;

revoke execute on function public.delete_riftbound_deck(uuid) from public, anon;
grant execute on function public.delete_riftbound_deck(uuid) to authenticated;
