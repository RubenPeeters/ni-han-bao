-- Riftbound decks and lending (#179): a deck marked not for lending holds its cards back from
-- lending, a deck is lent as one loan, and a deck page says who lends the cards you miss. Per
-- user like the decks and the ledger, so no guild_id. Additive, except riftbound_lend_options()
-- and profile_loans() (one more column each) and lend_riftbound_cards() (one more, optional,
-- argument), which the code shipping with this migration reads.

alter table public.riftbound_decks add column if not exists not_for_lending boolean not null default false;
-- The deck a loan lent whole, by its name then. No foreign key: the deck may change or be
-- deleted, and the ledger keeps what was recorded (a set null would edit it).
alter table public.riftbound_loans add column if not exists deck_name text check (char_length(deck_name) between 1 and 100);

-- Copies of each card a member's decks marked not for lending hold: each deck's Legend and
-- entries, added up, since each of those decks stays built.
create or replace function public.riftbound_deck_held(p_user text)
returns table (card_id text, held bigint)
language sql
stable
set search_path = ''
as $$
    select x.card_id, sum(x.quantity)::bigint
    from public.riftbound_decks d
    cross join lateral (
        select d.legend_id as card_id, 1 as quantity where d.legend_id is not null
        union all
        select c.card_id, c.quantity from public.riftbound_deck_cards c where c.deck_id = d.id
    ) x
    where d.user_id = p_user and d.not_for_lending
    group by x.card_id;
$$;

-- What a member offers to lend of each card: copies marked to lend and not out on a loan, but
-- never the copies their not-for-lending decks hold, whatever the per-card counts say.
create or replace function public.riftbound_free_to_lend(p_user text)
returns table (card_id text, copies bigint, languages text[])
language sql
stable
set search_path = ''
as $$
    select f.card_id,
        greatest(least(sum(f.free), sum(f.in_hand) - coalesce(min(h.held), 0)), 0)::bigint,
        -- shortcut: a language is listed if it has copies to lend before the decks hold theirs; per language when someone asks.
        array_agg(distinct f.language order by f.language) filter (where f.free > 0)
    from (
        select p.card_id, c.language::text as language,
            greatest(public.riftbound_lendable(c, pr) - coalesce(o.lent, 0), 0) as free,
            greatest(c.quantity - coalesce(o.lent, 0), 0) as in_hand
        from public.riftbound_collection c
        join public.riftbound_printings p on p.id = c.printing_id
        left join public.profiles pr on pr.user_id = c.user_id
        left join public.riftbound_lent_out(p_user) o on o.printing_id = c.printing_id and o.finish = c.finish
            and o.condition = c.condition and o.language = c.language::text
        where c.user_id = p_user
    ) f
    left join public.riftbound_deck_held(p_user) h on h.card_id = f.card_id
    group by f.card_id;
$$;

-- As in 20261101000000_riftbound_loans.sql, plus how many copies of the card the lender's
-- not-for-lending decks hold (/lend counts them as not marked to lend).
drop function public.riftbound_lend_options(text, text[], bigint);
create function public.riftbound_lend_options(p_lender text, p_cards text[], p_fixes bigint)
returns table (card_id text, printing_id text, finish text, condition text, language text,
    quantity integer, lendable integer, lent integer, held integer)
language sql
stable
set search_path = ''
as $$
    select p.card_id, c.printing_id, c.finish, c.condition, c.language::text, c.quantity,
        public.riftbound_lendable(c, pr), (coalesce(o.lent, 0) - coalesce(f.quantity, 0))::integer,
        coalesce(h.held, 0)::integer
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    left join public.profiles pr on pr.user_id = c.user_id
    left join public.riftbound_lent_out(p_lender) o on o.printing_id = c.printing_id and o.finish = c.finish
        and o.condition = c.condition and o.language = c.language::text
    left join public.riftbound_loan_cards f on f.loan_id = p_fixes and f.printing_id = c.printing_id
        and f.finish = c.finish and f.condition = c.condition and f.language = c.language
        and exists (select from public.riftbound_loans fl
                    where fl.id = p_fixes and fl.lender_id = p_lender and public.riftbound_loan_state(fl.id) = 'open')
    left join public.riftbound_deck_held(p_lender) h on h.card_id = p.card_id
    where c.user_id = p_lender and p.card_id = any (p_cards);
$$;

-- As in 20261101000000_riftbound_loans.sql, plus p_deck: the lender's deck lent whole, by
-- /lend deck or the deck page, which the loan names. Not one marked not for lending.
drop function public.lend_riftbound_cards(text, text, date, bigint, jsonb);
create function public.lend_riftbound_cards(
    p_lender text, p_borrower text, p_due date, p_fixes bigint, p_cards jsonb, p_deck uuid default null
)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare loan bigint; named text;
begin
    perform public.lock_user(p_lender, false);
    perform public.lock_user(p_borrower, false);
    if exists (select from public.forgotten_users f
               where f.user_hash in (public.user_hash(p_lender), public.user_hash(p_borrower))) then
        return null;
    end if;
    if p_fixes is not null and not exists (
        select from public.riftbound_loans l
        where l.id = p_fixes and l.lender_id = p_lender and public.riftbound_loan_state(l.id) <> 'replaced'
    ) then
        raise exception 'not_your_loan';
    end if;
    if p_deck is not null then
        select d.name into named from public.riftbound_decks d
        where d.id = p_deck and d.user_id = p_lender and not d.not_for_lending;
        if named is null then
            raise exception 'not_lendable_deck';
        end if;
    end if;
    insert into public.riftbound_loans (lender_id, borrower_id, due_on, replaces, deck_name)
    values (p_lender, p_borrower, p_due, p_fixes, named)
    returning id into loan;
    insert into public.riftbound_loan_cards (loan_id, printing_id, finish, condition, language, quantity)
    select loan, c.printing_id, c.finish, c.condition, c.language, c.quantity
    from jsonb_to_recordset(p_cards) as c (printing_id text, finish text, condition text, language text, quantity integer);
    return loan;
end;
$$;

revoke execute on function public.riftbound_deck_held(text) from public, anon, authenticated;
revoke execute on function public.riftbound_free_to_lend(text) from public, anon, authenticated;
revoke execute on function public.riftbound_lend_options(text, text[], bigint) from public, anon, authenticated;
revoke execute on function public.lend_riftbound_cards(text, text, date, bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.riftbound_lend_options(text, text[], bigint) to service_role;
grant execute on function public.lend_riftbound_cards(text, text, date, bigint, jsonb, uuid) to service_role;

-- Who has my missing cards? on a deck page, and Who has it? on a card page: per server the
-- visitor is in, the members who offer copies of the cards to lend.
create or replace function public.riftbound_card_lenders(p_cards text[])
returns table (card_id text, guild_id text, guild_name text, user_id text, display_name text, avatar_url text,
    copies bigint, languages text[])
language sql
stable
security definer
set search_path = ''
as $$
    select l.card_id, g.guild_id, g.name, m.user_id, m.display_name, m.avatar_url, l.copies, l.languages
    from public.guild_members b
    join public.guilds g on g.guild_id = b.guild_id
    join public.guild_members a on a.guild_id = b.guild_id and a.user_id <> b.user_id
    join public.members m on m.guild_id = a.guild_id and m.user_id = a.user_id and not m.hidden
    join public.profiles pr on pr.user_id = a.user_id and pr.lends_cards and pr.visibility <> 'private'
    join public.riftbound_free_to_lend(a.user_id) l on l.card_id = any (p_cards) and l.copies > 0
    where b.user_id = public.current_discord_id() and public.can_see_profile(a.user_id)
    order by l.card_id, g.name, l.copies desc, m.display_name;
$$;

revoke execute on function public.riftbound_card_lenders(text[]) from public;
grant execute on function public.riftbound_card_lenders(text[]) to authenticated;

-- As before, through riftbound_card_lenders(), so decks not for lending hold their cards here too.
create or replace function public.card_lenders(p_card text)
returns table (guild_id text, guild_name text, user_id text, display_name text, avatar_url text, copies bigint, languages text[])
language sql
stable
security definer
set search_path = ''
as $$
    select l.guild_id, l.guild_name, l.user_id, l.display_name, l.avatar_url, l.copies, l.languages
    from public.riftbound_card_lenders(array[p_card]) l;
$$;

-- The deck page's Not for lending: the caller's own deck only.
create or replace function public.set_riftbound_deck_lending(p_deck uuid, p_not_for_lending boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    update public.riftbound_decks set not_for_lending = p_not_for_lending
    where id = p_deck and user_id = public.current_discord_id();
    if not found then
        raise exception 'not your deck';
    end if;
end;
$$;

-- The deck page's Lend this deck picks copies from these, as /lend does: the caller's own rows.
create or replace function public.my_riftbound_lend_options(p_cards text[])
returns table (card_id text, printing_id text, finish text, condition text, language text,
    quantity integer, lendable integer, lent integer, held integer)
language sql
stable
security definer
set search_path = ''
as $$
    select * from public.riftbound_lend_options(public.current_discord_id(), p_cards, null);
$$;

-- Lend this deck: as /lend deck, from the caller to a member of a server they are in.
create or replace function public.lend_my_riftbound_deck(p_deck uuid, p_borrower text, p_due date, p_cards jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); loan bigint;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    if p_borrower = me or not exists (
        select from public.guild_members a join public.guild_members b on b.guild_id = a.guild_id
        where a.user_id = me and b.user_id = p_borrower
    ) then
        raise exception 'lend to a member of one of your servers';
    end if;
    if p_due < current_date then
        raise exception 'that due date has already passed';
    end if;
    loan := public.lend_riftbound_cards(me, p_borrower, p_due, null, p_cards, p_deck);
    if loan is null then
        raise exception 'one of you asked to be forgotten, so nothing was recorded';
    end if;
    return loan;
end;
$$;

-- The Loans tab's Confirm and Dispute, for a loan recorded on the site: the caller's own answer.
create or replace function public.answer_my_riftbound_loan(p_loan bigint, p_kind text, p_note text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
    -- Only the borrower's answers: the ledger's other kinds close a loan.
    select case when p_kind in ('confirmed', 'disputed') and public.current_discord_id() is not null
        then public.answer_riftbound_loan(public.current_discord_id(), p_loan, p_kind, p_note)
        else 'not_borrower' end;
$$;

revoke execute on function public.set_riftbound_deck_lending(uuid, boolean) from public, anon;
revoke execute on function public.my_riftbound_lend_options(text[]) from public, anon;
revoke execute on function public.lend_my_riftbound_deck(uuid, text, date, jsonb) from public, anon;
revoke execute on function public.answer_my_riftbound_loan(bigint, text, text) from public, anon;
grant execute on function public.set_riftbound_deck_lending(uuid, boolean) to authenticated;
grant execute on function public.my_riftbound_lend_options(text[]) to authenticated;
grant execute on function public.lend_my_riftbound_deck(uuid, text, date, jsonb) to authenticated;
grant execute on function public.answer_my_riftbound_loan(bigint, text, text) to authenticated;

-- As in 20261101000000_riftbound_loans.sql, plus the deck a loan lent whole.
drop function public.profile_loans(text);
create function public.profile_loans(u text)
returns table (id bigint, lent boolean, other_id text, other_name text, other_avatar text, due_on date,
    created_at timestamptz, state text, answer text, note text, cards jsonb, deck_name text)
language sql
stable
security definer
set search_path = ''
as $$
    select l.id, l.lender_id = me.id, o.id, m.display_name, m.avatar_url, l.due_on, l.created_at,
        public.riftbound_loan_state(l.id), a.kind, a.note,
        (
            select jsonb_agg(jsonb_build_object('name', rc.name, 'code', p.collector_code, 'finish', c.finish,
                'condition', c.condition, 'language', c.language, 'quantity', c.quantity) order by rc.name, p.collector_code)
            from public.riftbound_loan_cards c
            join public.riftbound_printings p on p.id = c.printing_id
            join public.riftbound_cards rc on rc.id = p.card_id
            where c.loan_id = l.id
        ),
        l.deck_name
    from (select public.current_discord_id() as id) me
    join public.riftbound_loans l on me.id in (l.lender_id, l.borrower_id) and u in (l.lender_id, l.borrower_id)
    cross join lateral (select case when l.lender_id = me.id then l.borrower_id else l.lender_id end as id) o
    left join lateral (
        select x.display_name, x.avatar_url from public.members x
        where x.user_id = o.id and not x.hidden
        order by x.updated_at desc limit 1
    ) m on true
    left join lateral (
        select e.kind, e.note from public.riftbound_loan_entries e
        where e.loan_id = l.id and e.kind in ('confirmed', 'disputed')
            and not exists (select from public.riftbound_loan_entries x where x.replaces = e.id)
        order by e.id desc limit 1
    ) a on true
    where public.riftbound_loan_state(l.id) <> 'replaced'
    order by l.due_on nulls last, l.id desc;
$$;

revoke execute on function public.profile_loans(text) from public;
grant execute on function public.profile_loans(text) to authenticated;
