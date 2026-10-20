-- Which decks can I build? (#174): someone else's public deck is in that list once the viewer
-- opened its link. Per user, so no guild_id. Additive only.

create table if not exists public.riftbound_deck_opens (
    user_id text not null,
    deck_id uuid not null references public.riftbound_decks (id) on delete cascade,
    opened_at timestamptz not null default now(),
    primary key (user_id, deck_id)
);

create index if not exists riftbound_deck_opens_deck on public.riftbound_deck_opens (deck_id);

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.riftbound_deck_opens
    for each row execute function public.skip_forgotten();

-- Your own rows only. Only open_riftbound_deck() writes.
alter table public.riftbound_deck_opens enable row level security;
create policy "own rows" on public.riftbound_deck_opens for select to authenticated
    using (user_id = public.current_discord_id());

-- The deck page, opened by someone other than its owner: remembered when the deck is public.
create or replace function public.open_riftbound_deck(p_deck uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
    insert into public.riftbound_deck_opens (user_id, deck_id)
    select public.current_discord_id(), d.id from public.riftbound_decks d
    where d.id = p_deck and d.visibility = 'public' and d.user_id <> public.current_discord_id()
    on conflict (user_id, deck_id) do update set opened_at = now();
$$;

revoke execute on function public.open_riftbound_deck(uuid) from public, anon;
grant execute on function public.open_riftbound_deck(uuid) to authenticated;
