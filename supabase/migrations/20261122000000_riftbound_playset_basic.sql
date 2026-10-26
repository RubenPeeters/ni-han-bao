-- A playset is the set's normal numbers only (#284): SET-NNN/TOTAL with NNN <= TOTAL, so no
-- alternate art (023a), starred (197*), overnumbered (169/166), SP, token or rune printing.
-- Same rule as isBasicPrinting() in lib/collection.ts.
create or replace function public.own_riftbound_playset(p_set text, p_language text, p_copies integer default 3)
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
        -- Null, so no row, when the code is not SET-NNN/TOTAL.
        and p.collector_number <= substring(p.collector_code from '^[^-]+-[0-9]+/([0-9]+)$')::integer
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
