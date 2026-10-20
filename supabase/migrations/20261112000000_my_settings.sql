-- The Settings page (#208): what the visitor can see of their own settings that only the bot
-- writes. Read only and additive: no table, no write path.

-- Per server the visitor is in, whether they ran /hide-me there. Security definer: the
-- members policy leaves hidden rows out, so the visitor could not read their own flag.
create or replace function public.my_server_visibility()
returns table (guild_id text, name text, hidden boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select g.guild_id, g.name, coalesce(m.hidden, false)
    from public.guild_members gm
    join public.guilds g on g.guild_id = gm.guild_id
    left join public.members m on m.guild_id = gm.guild_id and m.user_id = gm.user_id
    where gm.user_id = public.current_discord_id()
    order by g.name, g.guild_id;
$$;

-- The visitor's linked game accounts, without the PUUID: game_accounts has no policies, and
-- only its owner sees that an account is linked.
create or replace function public.my_game_accounts()
returns table (game text, region text, verified_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select a.game, a.region, a.verified_at
    from public.game_accounts a
    where a.user_id = public.current_discord_id()
    order by a.game;
$$;

revoke execute on function public.my_server_visibility() from public, anon;
revoke execute on function public.my_game_accounts() from public, anon;
grant execute on function public.my_server_visibility() to authenticated;
grant execute on function public.my_game_accounts() to authenticated;
