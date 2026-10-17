-- Opt-out for the public site: members set this with /hide-me and clear it with /show-me.
-- The bot keeps counting a hidden member; the website just never sees them.
alter table public.members add column if not exists hidden boolean not null default false;

-- Hide at the RLS level, not only in leaderboard(): the publishable key can query these
-- tables directly, so the policies themselves must leave hidden members out.
alter policy "public read" on public.members using (not hidden);

-- A hidden member's counts would still expose their user id, so they go too.
alter policy "public read" on public.message_counts using (
    exists (
        select from public.members m
        where m.user_id = message_counts.user_id and not m.hidden
    )
);

-- Same as before plus `not m.hidden`, so a caller that bypasses RLS still gets no hidden
-- members from it.
create or replace function public.leaderboard(since date default null, top integer default 10)
returns table (user_id text, display_name text, avatar_url text, message_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as message_count
    from public.message_counts c
    join public.members m on m.user_id = c.user_id
    where not m.hidden and (since is null or c.day >= since)
    group by m.user_id, m.display_name, m.avatar_url
    order by message_count desc, m.display_name
    limit top;
$$;
