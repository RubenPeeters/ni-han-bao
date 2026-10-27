-- A favourite League champion on the profile (#306): chosen, next to the computed most played
-- one. Additive only.

-- Riot's champion id as Data Dragon names it ("Ahri", "MonkeyKing"); null is none. Read with
-- the profile's own policy (can_see_profile()), so visibility, /hide-me and /forget-me cover it.
alter table public.profiles add column if not exists favourite_champion text
    check (favourite_champion ~ '^[A-Za-z]{1,40}$');

-- Settings: the caller's own row only. The site checks the id against Data Dragon; the
-- constraint only keeps out what is no id at all.
create function public.set_favourite_champion(p_champion text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id();
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    insert into public.profiles (user_id, favourite_champion) values (me, p_champion)
    on conflict (user_id) do update set favourite_champion = excluded.favourite_champion, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_favourite_champion(text) from public, anon;
grant execute on function public.set_favourite_champion(text) to authenticated;
