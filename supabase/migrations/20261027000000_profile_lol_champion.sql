-- The profile's most played League champion of the last 7 days (#140), shown with its icon
-- next to the ranks. Additive only.

-- For whoever may see the profile (can_see_profile()), like profile_ranks(). Only games of the
-- currently linked account, as in lol_week().
create or replace function public.profile_lol_champion(u text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select x.champion from public.lol_matches x
    join public.game_accounts a on a.user_id = x.user_id and a.game = 'lol' and a.external_id = x.puuid
    where x.user_id = u and x.played_at >= now() - interval '7 days' and public.can_see_profile(u)
    group by x.champion order by count(*) desc, x.champion limit 1;
$$;

revoke execute on function public.profile_lol_champion(text) from public;
grant execute on function public.profile_lol_champion(text) to anon, authenticated;
