-- Riftbound lending of single cards (#172): an append-only ledger. A loan and its cards are
-- rows; the borrower's confirmation or dispute, a return, a write-off and the bot's due-date
-- nudge are entries on it. Nothing is edited or deleted: a mistake is fixed by a new row that
-- replaces the old one. Lending moves possession, never ownership: riftbound_collection keeps
-- counting a lent copy as its owner's. Per user like the collection, so no guild_id.
-- Additive, except card_lenders() and forget_user(), which keep their signatures.

-- One loan, any number of cards, one due date and one confirmation. A deck lent as one loan
-- later is a column on this table, not a new ledger.
create table if not exists public.riftbound_loans (
    id bigint generated always as identity primary key,
    lender_id text not null,
    borrower_id text not null check (borrower_id <> lender_id),
    due_on date,
    -- A correction: the loan this one replaces, which then no longer counts.
    -- Set null only when forget_user() erases the replaced loan's other party.
    replaces bigint unique references public.riftbound_loans (id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists riftbound_loans_lender on public.riftbound_loans (lender_id);
create index if not exists riftbound_loans_borrower on public.riftbound_loans (borrower_id);

-- Which copies: a collection row's key, so lent copies are told apart from the rest.
create table if not exists public.riftbound_loan_cards (
    loan_id bigint not null references public.riftbound_loans (id) on delete cascade,
    printing_id text not null references public.riftbound_printings (id),
    finish text not null check (finish in ('normal', 'foil')),
    condition text not null check (condition in ('NM', 'LP', 'MP', 'HP')),
    language public.riftbound_language not null,
    quantity integer not null check (quantity > 0),
    primary key (loan_id, printing_id, finish, condition, language)
);

create table if not exists public.riftbound_loan_entries (
    id bigint generated always as identity primary key,
    loan_id bigint not null references public.riftbound_loans (id) on delete cascade,
    kind text not null check (kind in ('confirmed', 'disputed', 'returned', 'written_off', 'nudged')),
    -- Who recorded it; null for the bot's nudge.
    by_id text check (by_id is not null or kind = 'nudged'),
    -- The borrower's side of a dispute, as they typed it in the Dispute form.
    note text check (char_length(note) <= 300),
    -- A correction: the entry this one replaces (a new answer replaces the previous one).
    replaces bigint unique references public.riftbound_loan_entries (id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists riftbound_loan_entries_loan on public.riftbound_loan_entries (loan_id);
-- A loan closes once and is nudged once; a wrong close is fixed by replacing the loan.
create unique index if not exists riftbound_loan_closed on public.riftbound_loan_entries (loan_id)
    where kind in ('returned', 'written_off');
create unique index if not exists riftbound_loan_nudged on public.riftbound_loan_entries (loan_id)
    where kind = 'nudged';

-- Nobody reads these directly: the parties through profile_loans(), the bot with the secret key.
alter table public.riftbound_loans enable row level security;
alter table public.riftbound_loan_cards enable row level security;
alter table public.riftbound_loan_entries enable row level security;

-- Append-only, whoever writes. Erasing a person (forget_user(), the demo seed) is the one
-- exception, and says so for its own transaction (its deletes, and the set nulls they cause).
create or replace function public.riftbound_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_setting('ni_han_bao.erase_loans', true) = 'on' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;
    raise exception 'the lending ledger is append-only: record a correcting entry instead';
end;
$$;

create trigger append_only before update or delete on public.riftbound_loans
    for each row execute function public.riftbound_ledger_append_only();
create trigger append_only before update or delete on public.riftbound_loan_cards
    for each row execute function public.riftbound_ledger_append_only();
create trigger append_only before update or delete on public.riftbound_loan_entries
    for each row execute function public.riftbound_ledger_append_only();

-- 'replaced' once a later loan corrects it, else 'returned' or 'written_off' once closed by
-- an entry no later one replaces, else 'open'.
create or replace function public.riftbound_loan_state(p_loan bigint)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when exists (select from public.riftbound_loans r where r.replaces = p_loan) then 'replaced'
        else coalesce((
            select e.kind from public.riftbound_loan_entries e
            where e.loan_id = p_loan and e.kind in ('returned', 'written_off')
                and not exists (select from public.riftbound_loan_entries x where x.replaces = e.id)
            order by e.id desc limit 1
        ), 'open')
    end;
$$;

-- Copies of each of a lender's collection rows that are out on open loans.
create or replace function public.riftbound_lent_out(p_lender text)
returns table (printing_id text, finish text, condition text, language text, lent bigint)
language sql
stable
set search_path = ''
as $$
    select c.printing_id, c.finish, c.condition, c.language::text, sum(c.quantity)::bigint
    from public.riftbound_loans l
    join public.riftbound_loan_cards c on c.loan_id = l.id
    where l.lender_id = p_lender and public.riftbound_loan_state(l.id) = 'open'
    group by 1, 2, 3, 4;
$$;

-- Only the owner lends a card, and only copies they still have in hand: the collection
-- row's count minus what is out on their open loans. A borrowed copy is in nobody's
-- collection but its owner's, so it cannot be lent on. The row lock serializes two lends.
create or replace function public.riftbound_lend_own_copies()
returns trigger
language plpgsql
set search_path = ''
as $$
declare lender text; owned integer; lent bigint;
begin
    select l.lender_id into lender from public.riftbound_loans l where l.id = new.loan_id;
    select c.quantity into owned from public.riftbound_collection c
    where c.user_id = lender and c.printing_id = new.printing_id and c.finish = new.finish
        and c.condition = new.condition and c.language = new.language
    for update;
    select coalesce(sum(o.lent), 0) into lent from public.riftbound_lent_out(lender) o
    where o.printing_id = new.printing_id and o.finish = new.finish and o.condition = new.condition
        and o.language = new.language::text;
    if coalesce(owned, 0) < lent + new.quantity then
        raise exception 'only the owner lends a card, and only copies they have in hand';
    end if;
    return new;
end;
$$;

create trigger lend_own_copies before insert on public.riftbound_loan_cards
    for each row execute function public.riftbound_lend_own_copies();

-- /lend picks copies from these: the lender's rows of the cards, how many of each they offer
-- to lend (riftbound_lendable()) and how many are out already, not counting p_fixes, the
-- lender's open loan the new one replaces (lend_riftbound_cards() frees its copies too).
create or replace function public.riftbound_lend_options(p_lender text, p_cards text[], p_fixes bigint)
returns table (card_id text, printing_id text, finish text, condition text, language text,
    quantity integer, lendable integer, lent integer)
language sql
stable
set search_path = ''
as $$
    select p.card_id, c.printing_id, c.finish, c.condition, c.language::text, c.quantity,
        public.riftbound_lendable(c, pr), (coalesce(o.lent, 0) - coalesce(f.quantity, 0))::integer
    from public.riftbound_collection c
    join public.riftbound_printings p on p.id = c.printing_id
    left join public.profiles pr on pr.user_id = c.user_id
    left join public.riftbound_lent_out(p_lender) o on o.printing_id = c.printing_id and o.finish = c.finish
        and o.condition = c.condition and o.language = c.language::text
    left join public.riftbound_loan_cards f on f.loan_id = p_fixes and f.printing_id = c.printing_id
        and f.finish = c.finish and f.condition = c.condition and f.language = c.language
        and exists (select from public.riftbound_loans fl
                    where fl.id = p_fixes and fl.lender_id = p_lender and public.riftbound_loan_state(fl.id) = 'open')
    where c.user_id = p_lender and p.card_id = any (p_cards);
$$;

-- /lend: the loan and its cards in one transaction. p_cards is
-- [{printing_id, finish, condition, language, quantity}]; p_fixes the lender's own loan this
-- one corrects. The new loan's id, or null when either member asked to be forgotten.
create or replace function public.lend_riftbound_cards(
    p_lender text, p_borrower text, p_due date, p_fixes bigint, p_cards jsonb
)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare loan bigint;
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
    insert into public.riftbound_loans (lender_id, borrower_id, due_on, replaces)
    values (p_lender, p_borrower, p_due, p_fixes)
    returning id into loan;
    insert into public.riftbound_loan_cards (loan_id, printing_id, finish, condition, language, quantity)
    select loan, c.printing_id, c.finish, c.condition, c.language, c.quantity
    from jsonb_to_recordset(p_cards) as c (printing_id text, finish text, condition text, language text, quantity integer);
    return loan;
end;
$$;

-- The borrower's Confirm or Dispute, replacing their previous answer. 'ok', or why not:
-- 'not_borrower', 'closed' (corrected, returned or written off), 'unchanged'.
create or replace function public.answer_riftbound_loan(p_member text, p_loan bigint, p_kind text, p_note text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare borrower text; previous public.riftbound_loan_entries;
begin
    -- The lock serializes two answers to one loan; a plain select, so no update trigger fires.
    select l.borrower_id into borrower from public.riftbound_loans l where l.id = p_loan for update;
    if borrower is distinct from p_member then
        return 'not_borrower';
    end if;
    if public.riftbound_loan_state(p_loan) <> 'open' then
        return 'closed';
    end if;
    select e.* into previous from public.riftbound_loan_entries e
    where e.loan_id = p_loan and e.kind in ('confirmed', 'disputed')
        and not exists (select from public.riftbound_loan_entries x where x.replaces = e.id)
    order by e.id desc limit 1;
    if previous.kind = 'confirmed' and p_kind = 'confirmed' then
        return 'unchanged';
    end if;
    insert into public.riftbound_loan_entries (loan_id, kind, by_id, note, replaces)
    values (p_loan, p_kind, p_member, case when p_kind = 'disputed' then left(p_note, 300) end, previous.id);
    return 'ok';
end;
$$;

-- /return: the open loans between the two members (either way) are back, or, for
-- 'written_off', the member's cards lent to p_other are lost (the owner's call). p_loan
-- narrows it to one loan. The loans closed.
create or replace function public.close_riftbound_loans(p_member text, p_other text, p_kind text, p_loan bigint)
returns table (loan_id bigint, lender_id text, borrower_id text)
language sql
volatile
set search_path = ''
as $$
    with closed as (
        insert into public.riftbound_loan_entries (loan_id, kind, by_id)
        select l.id, p_kind, p_member from public.riftbound_loans l
        where p_kind in ('returned', 'written_off') and (p_loan is null or l.id = p_loan)
            and ((l.lender_id = p_member and l.borrower_id = p_other)
                or (p_kind = 'returned' and l.lender_id = p_other and l.borrower_id = p_member))
            and public.riftbound_loan_state(l.id) = 'open'
        on conflict (loan_id) where kind in ('returned', 'written_off') do nothing
        returning riftbound_loan_entries.loan_id
    )
    select c.loan_id, l.lender_id, l.borrower_id
    from closed c join public.riftbound_loans l on l.id = c.loan_id
    order by c.loan_id;
$$;

-- The bot's one nudge per loan: open loans due by p_today without one, each marked in the
-- same statement, so a restart cannot nudge twice.
create or replace function public.nudge_riftbound_loans(p_today date)
returns table (loan_id bigint, lender_id text, borrower_id text)
language sql
volatile
set search_path = ''
as $$
    with nudged as (
        insert into public.riftbound_loan_entries (loan_id, kind)
        select l.id, 'nudged' from public.riftbound_loans l
        where l.due_on <= p_today and public.riftbound_loan_state(l.id) = 'open'
        on conflict (loan_id) where kind = 'nudged' do nothing
        returning riftbound_loan_entries.loan_id
    )
    select n.loan_id, l.lender_id, l.borrower_id
    from nudged n join public.riftbound_loans l on l.id = n.loan_id;
$$;

revoke execute on function public.riftbound_ledger_append_only() from public, anon, authenticated;
revoke execute on function public.riftbound_lend_own_copies() from public, anon, authenticated;
revoke execute on function public.riftbound_loan_state(bigint) from public, anon, authenticated;
revoke execute on function public.riftbound_lent_out(text) from public, anon, authenticated;
revoke execute on function public.riftbound_lend_options(text, text[], bigint) from public, anon, authenticated;
revoke execute on function public.lend_riftbound_cards(text, text, date, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.answer_riftbound_loan(text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.close_riftbound_loans(text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.nudge_riftbound_loans(date) from public, anon, authenticated;
grant execute on function public.riftbound_loan_state(bigint) to service_role;
grant execute on function public.riftbound_lent_out(text) to service_role;
grant execute on function public.riftbound_lend_options(text, text[], bigint) to service_role;
grant execute on function public.lend_riftbound_cards(text, text, date, bigint, jsonb) to service_role;
grant execute on function public.answer_riftbound_loan(text, bigint, text, text) to service_role;
grant execute on function public.close_riftbound_loans(text, text, text, bigint) to service_role;
grant execute on function public.nudge_riftbound_loans(date) to service_role;

-- The profile's Loans tab: the visitor's loans that are not corrected, with the profile's
-- owner (all of them on your own profile, the ones between you two on someone else's). From
-- the visitor's side: lent is true for their own cards. The other party's name comes from a
-- server where they are not hidden; null when they are hidden everywhere.
create or replace function public.profile_loans(u text)
returns table (id bigint, lent boolean, other_id text, other_name text, other_avatar text, due_on date,
    created_at timestamptz, state text, answer text, note text, cards jsonb)
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
        )
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

-- Who has it?: as before, but copies out on a loan are not on offer.
create or replace function public.card_lenders(p_card text)
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
        select sum(f.free)::bigint as copies,
            array_agg(distinct f.language order by f.language) filter (where f.free > 0) as languages
        from (
            select c.language::text as language,
                greatest(public.riftbound_lendable(c, pr) - coalesce(o.lent, 0), 0) as free
            from public.riftbound_collection c
            join public.riftbound_printings p on p.id = c.printing_id
            left join public.riftbound_lent_out(a.user_id) o on o.printing_id = c.printing_id and o.finish = c.finish
                and o.condition = c.condition and o.language = c.language::text
            where c.user_id = a.user_id and p.card_id = p_card
        ) f
    ) l
    where b.user_id = public.current_discord_id() and l.copies > 0 and public.can_see_profile(a.user_id)
    order by g.name, l.copies desc, m.display_name;
$$;

-- /forget-me: as before, plus every loan the member is a party to, with its cards and
-- entries. The other party loses that record too: it names the forgotten member.
create or replace function public.forget_user(member text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare t text;
begin
    perform public.lock_user(member, true);
    insert into public.forgotten_users (user_hash) values (public.user_hash(member))
    on conflict (user_hash) do nothing;
    perform set_config('ni_han_bao.erase_loans', 'on', true);
    delete from public.riftbound_loans where member in (lender_id, borrower_id);
    perform set_config('ni_han_bao.erase_loans', 'off', true);
    for t in
        select c.relname::text
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'user_id' and not a.attisdropped
        order by c.relname = 'members', c.relname
    loop
        execute format('delete from public.%I where user_id = $1', t) using member;
    end loop;
    update public.stores set added_by = null where added_by = member;
end;
$$;
