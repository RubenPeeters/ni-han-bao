-- Event preview images (#262): a synced Discord event's cover, or the og:image of an
-- /event going link, written by the bot; the site falls back to the store's image.
-- upcoming_events() returns both. Its return type changes, so it is dropped and re-created
-- (in the migration's transaction); callers on main ignore the extra columns.
alter table public.events add column if not exists image_url text;

drop function if exists public.upcoming_events(text, timestamptz);
create function public.upcoming_events(guild text, until timestamptz default null)
returns table (
    id bigint, name text, starts_at timestamptz, url text, store_name text, store_city text, going text[],
    image_url text, store_image_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
    select e.id, e.name, e.starts_at, e.url, s.name, s.city,
        coalesce(array_agg(m.display_name order by m.display_name) filter (where m.user_id is not null), '{}'),
        e.image_url, s.image_url
    from public.events e
    left join public.stores s on s.id = e.store_id
    left join public.event_attendees a on a.event_id = e.id
    left join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    where e.guild_id = guild and e.starts_at >= now() and (until is null or e.starts_at < until)
    group by e.id, s.id
    order by e.starts_at;
$$;

grant execute on function public.upcoming_events(text, timestamptz) to authenticated, service_role;
