-- Home page hero (#23). Additive: the bot on main does not send avatar_url and leaves it null.
alter table public.bot_status add column if not exists avatar_url text;

-- Total messages since a day, for the home page. An aggregate, not per-member, so hidden
-- members' messages count too (they are never shown individually).
create or replace function public.message_total(since date, guild text)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
    select coalesce(sum(c.count), 0)::bigint
    from public.message_counts c
    where c.guild_id = guild and c.day >= since;
$$;

grant execute on function public.message_total(date, text) to anon, authenticated;
