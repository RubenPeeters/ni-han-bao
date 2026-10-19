-- Riftbound collection (#171): the language of each copy. Two copies of a printing in
-- different languages are different rows; existing rows become English. Ships with the code
-- that passes the language, so the functions change signature here.

-- One domain for both columns: a new language is one migration that swaps this check.
create domain public.riftbound_language as text check (value in ('en', 'zh-Hans', 'fr'));

alter table public.riftbound_collection
    add column if not exists language public.riftbound_language not null default 'en';
alter table public.riftbound_collection drop constraint riftbound_collection_pkey;
alter table public.riftbound_collection
    add primary key (user_id, printing_id, finish, condition, language);

-- The language entry starts from, on the site and in Discord: the one last added in.
alter table public.profiles
    add column if not exists card_language public.riftbound_language not null default 'en';

drop function public.set_riftbound_copies(text, text, text, integer, integer, integer);
create function public.set_riftbound_copies(
    p_printing text, p_finish text, p_condition text, p_language text,
    p_quantity integer, p_for_trade integer, p_lendable integer
)
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
    if p_quantity <= 0 then
        delete from public.riftbound_collection
        where user_id = me and printing_id = p_printing and finish = p_finish and condition = p_condition
            and language = p_language;
        return;
    end if;
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity, for_trade, lendable)
    values (me, p_printing, p_finish, p_condition, p_language, p_quantity,
        least(greatest(p_for_trade, 0), p_quantity),
        -- greatest() skips nulls, so keep null (follow the lending default) explicitly.
        case when p_lendable is not null then least(greatest(p_lendable, 0), p_quantity) end)
    on conflict (user_id, printing_id, finish, condition, language) do update set quantity = excluded.quantity,
        for_trade = excluded.for_trade, lendable = excluded.lendable, updated_at = now();
    -- skip_forgotten() drops the row silently; say so instead of reporting a save.
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
    insert into public.profiles (user_id, card_language) values (me, p_language)
    on conflict (user_id) do update set card_language = excluded.card_language, updated_at = now();
end;
$$;

revoke execute on function public.set_riftbound_copies(text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.set_riftbound_copies(text, text, text, text, integer, integer, integer) to authenticated;

-- "I own a playset of this set": every printing in it the caller has fewer than 3 copies of
-- (any finish, condition or language) is topped up to 3 with normal, NM copies in p_language.
drop function public.own_riftbound_playset(text);
create function public.own_riftbound_playset(p_set text, p_language text)
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
    insert into public.riftbound_collection (user_id, printing_id, finish, condition, language, quantity)
    select me, p.id, 'normal', 'NM', p_language, 3 - coalesce(owned.n, 0)
    from public.riftbound_printings p
    left join lateral (
        select sum(c.quantity)::integer as n from public.riftbound_collection c
        where c.user_id = me and c.printing_id = p.id
    ) owned on true
    where p.set_code = p_set and coalesce(owned.n, 0) < 3
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

revoke execute on function public.own_riftbound_playset(text, text) from public, anon;
grant execute on function public.own_riftbound_playset(text, text) to authenticated;

-- /collection add: normal NM copies added to what is there, in p_language or, when null, the
-- member's last-used one. The new count and the language, or no row for a forgotten user.
drop function public.add_riftbound_copies(text, text, integer);
create function public.add_riftbound_copies(member text, p_printing text, n integer, p_language text)
returns table (total integer, used_language text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare lang text := coalesce(p_language, (select card_language from public.profiles where user_id = member), 'en');
begin
    insert into public.riftbound_collection as c (user_id, printing_id, finish, condition, language, quantity)
    values (member, p_printing, 'normal', 'NM', lang, n)
    on conflict (user_id, printing_id, finish, condition, language) do update
        set quantity = c.quantity + excluded.quantity, updated_at = now()
    returning c.quantity, c.language::text into total, used_language;
    if found then
        insert into public.profiles (user_id, card_language) values (member, lang)
        on conflict (user_id) do update set card_language = excluded.card_language, updated_at = now();
        return next;
    end if;
end;
$$;

revoke execute on function public.add_riftbound_copies(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.add_riftbound_copies(text, text, integer, text) to service_role;

-- The profile's Collection tab: copies and distinct printings per set and rarity (language
-- null), and per language (set and rarity null), for whoever may see the profile.
drop function public.profile_collection(text);
create function public.profile_collection(u text)
returns table (set_code text, rarity text, language text, copies bigint, printings bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select p.set_code, coalesce(p.rarity, 'Unknown'), c.language::text, sum(c.quantity)::bigint, count(distinct p.id)
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    where c.user_id = u and public.can_see_profile(u)
    -- Separate groupings: a printing owned in two languages is still one different card per set.
    group by grouping sets ((p.set_code, coalesce(p.rarity, 'Unknown')), (c.language))
    order by 1, 2, 3;
$$;

revoke execute on function public.profile_collection(text) from public;
grant execute on function public.profile_collection(text) to anon, authenticated;

-- Who has it?: as before, plus the languages of the copies on offer.
drop function public.card_lenders(text);
create function public.card_lenders(p_card text)
returns table (guild_id text, guild_name text, user_id text, display_name text, avatar_url text, copies bigint, languages text[])
language sql
stable
security definer
set search_path = ''
as $$
    select g.guild_id, g.name, m.user_id, m.display_name, m.avatar_url, l.copies, l.languages
    from public.guild_members b
    join public.guilds g on g.guild_id = b.guild_id
    join public.guild_members a on a.guild_id = b.guild_id and a.user_id <> b.user_id
    join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    join public.profiles pr on pr.user_id = a.user_id and pr.lends_cards and pr.visibility <> 'private'
    cross join lateral (
        select sum(public.riftbound_lendable(c, pr))::bigint as copies,
            array_agg(distinct c.language::text order by c.language::text) filter (where public.riftbound_lendable(c, pr) > 0) as languages
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        where c.user_id = a.user_id and p.card_id = p_card
    ) l
    where b.user_id = public.current_discord_id() and l.copies > 0 and public.can_see_profile(a.user_id)
    order by g.name, l.copies desc, m.display_name;
$$;

revoke execute on function public.card_lenders(text) from public;
grant execute on function public.card_lenders(text) to authenticated;
