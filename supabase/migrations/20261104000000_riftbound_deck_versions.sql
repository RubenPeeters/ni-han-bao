-- Deck version history (#176): every save of a deck is kept as a version. Per user like the
-- decks, so no guild_id. Additive: save_riftbound_deck() and add_riftbound_deck_card() keep
-- their signatures.

create table if not exists public.riftbound_deck_versions (
    -- Cascade: deleting a deck, also by forget_user(), deletes its history.
    deck_id uuid not null references public.riftbound_decks (id) on delete cascade,
    version integer not null check (version > 0),
    saved_at timestamptz not null default now(),
    -- The deck as saved, but its visibility: old versions follow the deck's current one.
    name text not null,
    legend_id text,
    champion_id text,
    notes text not null,
    language public.riftbound_language not null,
    allow_other_languages boolean not null,
    -- [{section, card_id, printing_id, quantity}]: no foreign keys, so a version outlives a
    -- card leaving the catalogue; restoring goes through save_riftbound_deck(), which checks.
    entries jsonb not null,
    primary key (deck_id, version)
);

-- The deck's own policy decides, as for its cards.
alter table public.riftbound_deck_versions enable row level security;
create policy "versions of visible decks" on public.riftbound_deck_versions for select to authenticated
    using (exists (select from public.riftbound_decks d where d.id = deck_id));

-- The deck as it is now, as its next version. Only the save functions below call it.
create or replace function public.snapshot_riftbound_deck(p_deck uuid)
returns void
language sql
volatile
set search_path = ''
as $$
    insert into public.riftbound_deck_versions
        (deck_id, version, saved_at, name, legend_id, champion_id, notes, language, allow_other_languages, entries)
    select d.id, coalesce((select max(v.version) from public.riftbound_deck_versions v where v.deck_id = d.id), 0) + 1,
        d.updated_at, d.name, d.legend_id, d.champion_id, d.notes, d.language, d.allow_other_languages,
        coalesce((
            select jsonb_agg(jsonb_build_object('section', c.section, 'card_id', c.card_id, 'printing_id', c.printing_id,
                'quantity', c.quantity) order by c.section, c.card_id, c.printing_id)
            from public.riftbound_deck_cards c where c.deck_id = d.id
        ), '[]')
    from public.riftbound_decks d where d.id = p_deck;
$$;

revoke execute on function public.snapshot_riftbound_deck(uuid) from public, anon, authenticated;

-- Every deck so far starts its history as it is now.
select public.snapshot_riftbound_deck(id) from public.riftbound_decks;

-- As in 20261102000000_riftbound_decks.sql, plus the version at the end.
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
    perform public.snapshot_riftbound_deck(deck);
    return deck;
end;
$$;

-- As before, plus the version at the end: Add to deck changes the deck as a save does.
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
    else
        insert into public.riftbound_deck_cards (deck_id, section, card_id, quantity)
        values (p_deck, case kind when 'Rune' then 'runes' when 'Battlefield' then 'battlefields' else 'main' end, p_card, 1)
        on conflict (deck_id, section, card_id, printing_id)
            do update set quantity = least(public.riftbound_deck_cards.quantity + 1, 99);
        update public.riftbound_decks set updated_at = now() where id = p_deck;
    end if;
    perform public.snapshot_riftbound_deck(p_deck);
end;
$$;
