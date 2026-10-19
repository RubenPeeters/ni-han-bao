-- message_total() for the logged-in home (#139). Security invoker, it ran under the
-- message_counts policy that leaves hidden members out, so a server's total dropped their
-- messages. Security definer counts them, like public_totals(): an aggregate names nobody.
-- The membership check takes over from RLS: anyone else gets 0, as anon already did.
create or replace function public.message_total(since date, guild text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(sum(c.count), 0)::bigint
    from public.message_counts c
    where c.guild_id = guild and c.day >= since and public.is_guild_member(guild);
$$;
