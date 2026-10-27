-- The profile's favourite League champion (#306), chosen rather than computed like
-- profile_lol_champion(). Per person, across servers, so on profiles. Additive only.

-- Data Dragon's champion id ("Ahri", "MonkeyKing"); null: none. forget_user() deletes it
-- with the row.
alter table public.profiles add column if not exists favourite_champion text
    check (favourite_champion ~ '^[A-Za-z0-9]{1,40}$');

-- Settings: the visitor's own row only. The site checks the id against Data Dragon first;
-- the column's check keeps anything else out.
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

-- For whoever may see the profile (can_see_profile()), like profile_lol_champion(): it follows
-- the profile's visibility and /hide-me.
create function public.profile_favourite_champion(u text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select p.favourite_champion from public.profiles p where p.user_id = u and public.can_see_profile(u);
$$;

revoke execute on function public.profile_favourite_champion(text) from public;
grant execute on function public.profile_favourite_champion(text) to anon, authenticated;
