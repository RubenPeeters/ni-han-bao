-- Collection import from CSV (#242): the caller's own rows, added to what is there. Additive
-- only: one new function, no table.

-- p_rows: [{printing_id, quantity, want}], parsed and previewed on the site. Copies become
-- normal, NM ones in the member's card language, for_trade 0 and lendable following their
-- default; wants add to their hand-added entry for the printing, at most 99. Ids not in the
-- catalogue are skipped, not an error. Returns the copies and wishlist entries added.
create or replace function public.import_riftbound_collection(p_rows jsonb)
returns table (copies integer, wishes integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); lang text; c integer; n integer; w integer; wanted integer;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    select coalesce((select p.card_language from public.profiles p where p.user_id = me), 'en') into lang;
    with incoming as (
        -- The same printing twice in a file is one row.
        select p.id as printing_id, p.card_id, sum(greatest(r.quantity, 0))::integer as quantity,
            sum(greatest(r.want, 0))::integer as want
        from jsonb_to_recordset(coalesce(p_rows, '[]')) r (printing_id text, quantity integer, want integer)
        join public.riftbound_printings p on p.id = r.printing_id
        group by p.id, p.card_id
    ),
    added as (
        insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
        select me, x.printing_id, 'normal', 'NM', lang, x.quantity from incoming x where x.quantity > 0
        on conflict (user_id, printing_id, finish, condition, language) do update
            set quantity = public.riftbound_collection.quantity + excluded.quantity, updated_at = now()
        returning 1
    ),
    wished as (
        insert into public.riftbound_wishlist (user_id, card_id, printing_id, quantity)
        select me, x.card_id, x.printing_id, least(x.want, 99) from incoming x where x.want > 0
        on conflict (user_id, card_id, printing_id) do update
            set quantity = least(public.riftbound_wishlist.quantity + excluded.quantity, 99), updated_at = now()
        returning 1
    )
    select (select coalesce(sum(x.quantity), 0) from incoming x)::integer, (select count(*) from added)::integer,
        (select count(*) from wished)::integer, (select count(*) from incoming x where x.want > 0)::integer
    into c, n, w, wanted;
    -- skip_forgotten() drops the rows silently; say so instead of reporting a save.
    if (n = 0 and c > 0) or (w = 0 and wanted > 0) then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
    return query select c, w;
end;
$$;

revoke execute on function public.import_riftbound_collection(jsonb) from public, anon;
grant execute on function public.import_riftbound_collection(jsonb) to authenticated;
