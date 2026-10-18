-- Event attendance (#115): /event going, the server's Discord scheduled events, and who is
-- going where. Only what members say themselves: nothing is read from PlayRiftbound.
-- Additive only: the previous release keeps working against it.

create table if not exists public.events (
    id bigint generated always as identity primary key,
    guild_id text not null,
    -- Matched from a Discord event's location text, or picked in /event going; null when unknown.
    store_id bigint references public.stores (id) on delete set null,
    -- A Discord event's title; /event going events have none.
    name text,
    starts_at timestamptz not null,
    url text,
    -- Set for events imported from Discord; their attendees are the members marked Interested.
    discord_event_id text unique,
    created_at timestamptz not null default now()
);

-- One /event going event per store and time, so two members adding it at once get the same one.
create unique index if not exists events_store_time on public.events (guild_id, store_id, starts_at)
    where discord_event_id is null;

alter table public.events enable row level security;

create policy "members read" on public.events for select to authenticated
    using (public.is_guild_member(guild_id));

create table if not exists public.event_attendees (
    guild_id text not null,
    event_id bigint not null references public.events (id) on delete cascade,
    user_id text not null,
    created_at timestamptz not null default now(),
    primary key (event_id, user_id)
);

alter table public.event_attendees enable row level security;

create policy "members read" on public.event_attendees for select to authenticated using (
    public.is_guild_member(guild_id) and not public.is_hidden_member(guild_id, user_id)
);

create trigger skip_forgotten before insert on public.event_attendees
    for each row execute function public.skip_forgotten();

-- Upcoming events with the names of who is going, for the site and the weekly report.
-- Security invoker, so the site reads under RLS; the bot reads with the secret key, which
-- bypasses it, hence the explicit hidden filter. A goer without a members row has no name
-- to show and is left out; the bot writes one whenever it records attendance.
create or replace function public.upcoming_events(guild text, until timestamptz default null)
returns table (id bigint, name text, starts_at timestamptz, url text, store_name text, store_city text, going text[])
language sql
stable
security invoker
set search_path = ''
as $$
    select e.id, e.name, e.starts_at, e.url, s.name, s.city,
        coalesce(array_agg(m.display_name order by m.display_name) filter (where m.user_id is not null), '{}')
    from public.events e
    left join public.stores s on s.id = e.store_id
    left join public.event_attendees a on a.event_id = e.id
    left join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    where e.guild_id = guild and e.starts_at >= now() and (until is null or e.starts_at < until)
    group by e.id, s.id
    order by e.starts_at
    limit 25;
$$;

grant execute on function public.upcoming_events(text, timestamptz) to authenticated, service_role;
