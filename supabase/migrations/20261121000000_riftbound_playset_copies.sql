-- "I own 2 playsets of this set" (#274): own_riftbound_playset() tops up to p_copies, 3 or 6.
-- The default keeps the previous release's two-argument calls working.
drop function public.own_riftbound_playset(text, text);
create function public.own_riftbound_playset(p_set text, p_language text, p_copies integer default 3)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); n integer;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    if p_copies is null or p_copies not in (3, 6) then
        raise exception 'a playset top-up is 3 or 6 copies';
    end if;
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
    select me, p.id, 'normal', 'NM', p_language, p_copies - coalesce(owned.n, 0)
    from public.riftbound_printings p
    left join lateral (
        select sum(c.quantity)::integer as n from public.riftbound_collection c
        where c.user_id = me and c.printing_id = p.id
    ) owned on true
    where p.set_code = p_set and coalesce(owned.n, 0) < p_copies
    on conflict (user_id, printing_id, finish, condition, language) do update
        set quantity = public.riftbound_collection.quantity + excluded.quantity, updated_at = now();
    get diagnostics n = row_count;
    if n > 0 then
        insert into public.profiles (user_id, card_language) values (me, p_language)
        on conflict (user_id) do update set card_language = excluded.card_language, updated_at = now();
    end if;
    return n;
end;
$$;

revoke execute on function public.own_riftbound_playset(text, text, integer) from public, anon;
grant execute on function public.own_riftbound_playset(text, text, integer) to authenticated;
