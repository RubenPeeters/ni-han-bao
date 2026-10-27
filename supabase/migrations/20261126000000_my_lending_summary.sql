-- /loans' summary line (#300): whether the caller lends cards, the copies they lend now (the sum
-- of riftbound_free_to_lend()), the copies marked to lend that their decks not for lending hold,
-- and the copies out on their open loans. Additive only.
create function public.my_lending_summary()
returns table (lends_cards boolean, free bigint, held bigint, lent bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with me as (select public.current_discord_id() as id),
    f as (
        select coalesce(sum((x ->> 'copies')::bigint), 0) as n
        from me, public.riftbound_free_to_lend(me.id) l, jsonb_array_elements(l.copies) x
    ),
    -- Marked to lend and in hand: what riftbound_free_to_lend() starts from, before the decks.
    m as (
        select coalesce(sum(greatest(public.riftbound_lendable(c, pr) - coalesce(o.lent, 0), 0)), 0) as n
        from me
        join public.riftbound_collection c on c.user_id = me.id
        left join public.profiles pr on pr.user_id = c.user_id
        left join public.riftbound_lent_out(me.id) o on o.printing_id = c.printing_id and o.finish = c.finish
            and o.condition = c.condition and o.language = c.language::text
    )
    select coalesce(pr.lends_cards, false), f.n::bigint, (m.n - f.n)::bigint,
        (select coalesce(sum(o.lent), 0) from public.riftbound_lent_out(me.id) o)::bigint
    from me cross join f cross join m
    left join public.profiles pr on pr.user_id = me.id;
$$;

revoke execute on function public.my_lending_summary() from public, anon;
grant execute on function public.my_lending_summary() to authenticated;
