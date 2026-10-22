-- leaderboard() timed out on a server with years of history (#258). Security invoker, it ran
-- under the message_counts policy, whose is_guild_member() is security definer, so it is not
-- inlined and ran once per row. Security definer checks membership once, like message_total()
-- (#144): anyone else gets no rows, as RLS gave them. Hidden members stay off the board.
create or replace function public.leaderboard(
    since date default null, top integer default 10, guild text default '1525456003854897152'
)
returns table (user_id text, display_name text, avatar_url text, message_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select m.user_id, m.display_name, m.avatar_url, sum(c.count)::bigint as message_count
    from public.message_counts c
    join public.members m on m.guild_id = c.guild_id and m.user_id = c.user_id
    where c.guild_id = guild and not m.hidden and (since is null or c.day >= since)
        and public.is_guild_member(guild)
    group by m.user_id, m.display_name, m.avatar_url
    order by message_count desc, m.display_name
    limit top;
$$;

grant execute on function public.leaderboard(date, integer, text) to anon, authenticated;
