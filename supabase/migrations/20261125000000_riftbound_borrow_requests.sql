-- Borrow requests (#299): a member asks a lender for cards from Who has it?, the bot DMs the
-- lender, who accepts (the loan is recorded through lend_riftbound_cards(), as /lend does) or
-- declines. A request is not a loan. Append-only like the ledger (#172): a request, its cards
-- and its one answer are rows. Per user like the ledger, so no guild_id. Additive, except
-- forget_user(), which keeps its signature.

create table if not exists public.riftbound_borrow_requests (
    id bigint generated always as identity primary key,
    borrower_id text not null,
    lender_id text not null check (lender_id <> borrower_id),
    -- The copies the borrower takes; a card in any of these will do.
    languages public.riftbound_language[] not null check (cardinality(languages) > 0),
    wanted_by date,
    note text check (char_length(note) <= 300),
    created_at timestamptz not null default now()
);

create index if not exists riftbound_borrow_requests_borrower on public.riftbound_borrow_requests (borrower_id);
create index if not exists riftbound_borrow_requests_lender on public.riftbound_borrow_requests (lender_id);

-- Cards, not copies: the lender picks the copies on Accept.
create table if not exists public.riftbound_borrow_request_cards (
    request_id bigint not null references public.riftbound_borrow_requests (id) on delete cascade,
    card_id text not null references public.riftbound_cards (id),
    quantity integer not null check (quantity between 1 and 99),
    primary key (request_id, card_id)
);

-- The one answer: accepted (with the loan it became), declined (with the lender's optional
-- reason) or cancelled by the borrower.
create table if not exists public.riftbound_borrow_request_answers (
    request_id bigint primary key references public.riftbound_borrow_requests (id) on delete cascade,
    kind text not null check (kind in ('accepted', 'declined', 'cancelled')),
    loan_id bigint references public.riftbound_loans (id) on delete cascade,
    check ((kind = 'accepted') = (loan_id is not null)),
    note text check (char_length(note) <= 300),
    created_at timestamptz not null default now()
);

-- The bot's DMs: the lender once per request, the borrower once per answer. Claimed before the
-- send, so a restart does not DM again; a failure (DMs closed) is recorded, never retried.
-- Bookkeeping like riftbound_feed_broken_dms, not part of the ledger.
create table if not exists public.riftbound_borrow_request_dms (
    request_id bigint not null references public.riftbound_borrow_requests (id) on delete cascade,
    recipient text not null check (recipient in ('lender', 'borrower')),
    sent_at timestamptz not null default now(),
    failed_at timestamptz,
    primary key (request_id, recipient)
);

-- Nobody reads these directly: the parties through my_borrow_requests(), the bot with the secret key.
alter table public.riftbound_borrow_requests enable row level security;
alter table public.riftbound_borrow_request_cards enable row level security;
alter table public.riftbound_borrow_request_answers enable row level security;
alter table public.riftbound_borrow_request_dms enable row level security;

-- Erased only with a person (forget_user(), the demo seed), as the ledger.
create trigger append_only before update or delete on public.riftbound_borrow_requests
    for each row execute function public.riftbound_ledger_append_only();
create trigger append_only before update or delete on public.riftbound_borrow_request_cards
    for each row execute function public.riftbound_ledger_append_only();
create trigger append_only before update or delete on public.riftbound_borrow_request_answers
    for each row execute function public.riftbound_ledger_append_only();

-- 'open', or the answer's kind.
create function public.riftbound_borrow_request_state(p_request bigint)
returns text
language sql
stable
set search_path = ''
as $$
    select coalesce((select a.kind from public.riftbound_borrow_request_answers a where a.request_id = p_request), 'open');
$$;

-- Ask to borrow: from the caller to p_lender. p_cards is [{card_id, quantity}]. Only a member
-- Who has it? shows the caller (not hidden, private or forgotten, lending), for copies they
-- have available to lend in the accepted languages (riftbound_card_lenders()), and one open
-- request per borrower, lender and card. The request's id.
create function public.ask_to_borrow(p_lender text, p_cards jsonb, p_languages text[], p_wanted_by date, p_note text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare me text := public.current_discord_id(); request bigint;
begin
    if me is null then
        raise exception 'not logged in with Discord';
    end if;
    perform public.lock_user(me, false);
    perform public.lock_user(p_lender, false);
    -- Serializes two asks by the same borrower, for the one-open-request check.
    perform pg_catalog.pg_advisory_xact_lock(299, pg_catalog.hashtext(me));
    if exists (select from public.forgotten_users f where f.user_hash = public.user_hash(me)) then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
    if jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) = 0 then
        raise exception 'ask for at least one card';
    end if;
    if coalesce(cardinality(p_languages), 0) = 0 then
        raise exception 'pick at least one language';
    end if;
    if p_wanted_by < current_date then
        raise exception 'that date has already passed';
    end if;
    if exists (
        select from jsonb_to_recordset(p_cards) as c (card_id text, quantity integer)
        where c.quantity is null or c.quantity < 1
    ) or exists (
        -- Summed per card, as inserted below: two entries of one card count together.
        select from (
            select c.card_id, sum(c.quantity) as quantity
            from jsonb_to_recordset(p_cards) as c (card_id text, quantity integer)
            group by c.card_id
        ) c
        where c.quantity > coalesce((
            select max(x.n) from (
                select sum((j ->> 'copies')::bigint) as n
                from public.riftbound_card_lenders(array[c.card_id]) l
                cross join jsonb_array_elements(l.copies) j
                where l.user_id = p_lender and l.printing_id is null and j ->> 'language' = any (p_languages)
                group by l.guild_id
            ) x
        ), 0)
    ) then
        raise exception 'they do not have that many copies to lend in those languages';
    end if;
    if exists (
        select from public.riftbound_borrow_requests r
        join public.riftbound_borrow_request_cards rc on rc.request_id = r.id
        where r.borrower_id = me and r.lender_id = p_lender
            and rc.card_id in (select c.card_id from jsonb_to_recordset(p_cards) as c (card_id text))
            and public.riftbound_borrow_request_state(r.id) = 'open'
    ) then
        raise exception 'you already asked them for one of these cards: wait for their answer or cancel that request';
    end if;
    insert into public.riftbound_borrow_requests (borrower_id, lender_id, languages, wanted_by, note)
    values (me, p_lender, p_languages::public.riftbound_language[], p_wanted_by, nullif(left(trim(p_note), 300), ''))
    returning id into request;
    insert into public.riftbound_borrow_request_cards (request_id, card_id, quantity)
    select request, c.card_id, sum(c.quantity)
    from jsonb_to_recordset(p_cards) as c (card_id text, quantity integer)
    group by c.card_id;
    return request;
end;
$$;

-- The borrower's Cancel. 'ok', or why not: 'not_borrower', 'closed'.
create function public.cancel_borrow_request(p_request bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare borrower text;
begin
    -- The lock serializes a cancel and an answer; a plain select, so no update trigger fires.
    select r.borrower_id into borrower from public.riftbound_borrow_requests r where r.id = p_request for update;
    if borrower is null or borrower is distinct from public.current_discord_id() then
        return 'not_borrower';
    end if;
    if public.riftbound_borrow_request_state(p_request) <> 'open' then
        return 'closed';
    end if;
    insert into public.riftbound_borrow_request_answers (request_id, kind) values (p_request, 'cancelled');
    return 'ok';
end;
$$;

-- The lender's Decline, with an optional reason. 'ok', or why not: 'not_lender', 'closed'.
create function public.decline_riftbound_borrow_request(p_member text, p_request bigint, p_note text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare lender text;
begin
    select r.lender_id into lender from public.riftbound_borrow_requests r where r.id = p_request for update;
    if lender is null or lender is distinct from p_member then
        return 'not_lender';
    end if;
    if public.riftbound_borrow_request_state(p_request) <> 'open' then
        return 'closed';
    end if;
    insert into public.riftbound_borrow_request_answers (request_id, kind, note)
    values (p_request, 'declined', nullif(left(trim(p_note), 300), ''));
    return 'ok';
end;
$$;

-- The lender's Accept: the loan through lend_riftbound_cards(), which checks the copies are the
-- lender's and in hand. p_cards as there; they must be the request's cards, card for card, in
-- its languages. The loan's id, or why not: 'not_lender', 'closed', 'not_the_request',
-- 'forgotten', each raised.
create function public.accept_riftbound_borrow_request(p_member text, p_request bigint, p_due date, p_cards jsonb)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare r public.riftbound_borrow_requests; loan bigint;
begin
    select * into r from public.riftbound_borrow_requests x where x.id = p_request for update;
    if r.lender_id is null or r.lender_id is distinct from p_member then
        raise exception 'not_lender';
    end if;
    if public.riftbound_borrow_request_state(p_request) <> 'open' then
        raise exception 'closed';
    end if;
    if jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) = 0 or exists (
        select from jsonb_to_recordset(p_cards) as c (language text)
        where c.language is null or c.language <> all (r.languages::text[])
    ) or exists (
        select from (select rc.card_id, rc.quantity::bigint as n from public.riftbound_borrow_request_cards rc where rc.request_id = p_request) need
        full join (
            select p.card_id, sum(c.quantity) as n
            from jsonb_to_recordset(p_cards) as c (printing_id text, quantity integer)
            left join public.riftbound_printings p on p.id = c.printing_id
            group by p.card_id
        ) got on got.card_id = need.card_id
        where need.n is distinct from got.n
    ) then
        raise exception 'not_the_request';
    end if;
    loan := public.lend_riftbound_cards(r.lender_id, r.borrower_id, p_due, null, p_cards);
    if loan is null then
        raise exception 'forgotten';
    end if;
    insert into public.riftbound_borrow_request_answers (request_id, kind, loan_id) values (p_request, 'accepted', loan);
    return loan;
end;
$$;

-- The bot's DMs to send, each claimed in the same statement so a restart cannot send twice:
-- open requests the lender was not told about, and answers the borrower was not told about.
create function public.claim_borrow_request_dms()
returns table (request_id bigint, recipient text)
language sql
volatile
set search_path = ''
as $$
    insert into public.riftbound_borrow_request_dms (request_id, recipient)
    select r.id, 'lender' from public.riftbound_borrow_requests r
    where public.riftbound_borrow_request_state(r.id) = 'open'
    union all
    select a.request_id, 'borrower' from public.riftbound_borrow_request_answers a where a.kind in ('accepted', 'declined')
    on conflict do nothing
    returning riftbound_borrow_request_dms.request_id, riftbound_borrow_request_dms.recipient;
$$;

-- The site's Accept and Decline on /loans: the caller as the lender.
create function public.accept_my_borrow_request(p_request bigint, p_due date, p_cards jsonb)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
    select public.accept_riftbound_borrow_request(public.current_discord_id(), p_request, p_due, p_cards);
$$;

create function public.decline_my_borrow_request(p_request bigint, p_note text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
    select public.decline_riftbound_borrow_request(public.current_discord_id(), p_request, p_note);
$$;

-- /loans' Requests: the caller's requests, either way, from their side: asked is true for those
-- they sent. The other party's name from a server where they are not hidden; null when hidden
-- everywhere. dm_failed: the lender's DM could not be delivered (DMs closed).
create function public.my_borrow_requests()
returns table (id bigint, asked boolean, other_id text, other_name text, other_avatar text, languages text[],
    wanted_by date, note text, created_at timestamptz, state text, loan_id bigint, answer_note text,
    dm_failed boolean, cards jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select r.id, r.borrower_id = me.id, o.id, m.display_name, m.avatar_url, r.languages::text[], r.wanted_by, r.note,
        r.created_at, public.riftbound_borrow_request_state(r.id), a.loan_id, a.note,
        exists (select from public.riftbound_borrow_request_dms d
                where d.request_id = r.id and d.recipient = 'lender' and d.failed_at is not null),
        (
            select jsonb_agg(jsonb_build_object('card_id', c.card_id, 'name', rc.name, 'quantity', c.quantity) order by rc.name)
            from public.riftbound_borrow_request_cards c
            join public.riftbound_cards rc on rc.id = c.card_id
            where c.request_id = r.id
        )
    from (select public.current_discord_id() as id) me
    join public.riftbound_borrow_requests r on me.id in (r.borrower_id, r.lender_id)
    cross join lateral (select case when r.borrower_id = me.id then r.lender_id else r.borrower_id end as id) o
    left join public.riftbound_borrow_request_answers a on a.request_id = r.id
    left join lateral (
        select x.display_name, x.avatar_url from public.members x
        where x.user_id = o.id and not x.hidden
        order by x.updated_at desc limit 1
    ) m on true
    order by r.id desc;
$$;

revoke execute on function public.riftbound_borrow_request_state(bigint) from public, anon, authenticated;
revoke execute on function public.decline_riftbound_borrow_request(text, bigint, text) from public, anon, authenticated;
revoke execute on function public.accept_riftbound_borrow_request(text, bigint, date, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_borrow_request_dms() from public, anon, authenticated;
grant execute on function public.riftbound_borrow_request_state(bigint) to service_role;
grant execute on function public.decline_riftbound_borrow_request(text, bigint, text) to service_role;
grant execute on function public.accept_riftbound_borrow_request(text, bigint, date, jsonb) to service_role;
grant execute on function public.claim_borrow_request_dms() to service_role;
revoke execute on function public.ask_to_borrow(text, jsonb, text[], date, text) from public, anon;
revoke execute on function public.cancel_borrow_request(bigint) from public, anon;
revoke execute on function public.accept_my_borrow_request(bigint, date, jsonb) from public, anon;
revoke execute on function public.decline_my_borrow_request(bigint, text) from public, anon;
revoke execute on function public.my_borrow_requests() from public, anon;
grant execute on function public.ask_to_borrow(text, jsonb, text[], date, text) to authenticated;
grant execute on function public.cancel_borrow_request(bigint) to authenticated;
grant execute on function public.accept_my_borrow_request(bigint, date, jsonb) to authenticated;
grant execute on function public.decline_my_borrow_request(bigint, text) to authenticated;
grant execute on function public.my_borrow_requests() to authenticated;

-- As in 20261106000000_riftbound_trades.sql, plus every borrow request the member is a party
-- to: the other party loses it too, as with loans.
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
    delete from public.riftbound_borrow_requests where member in (lender_id, borrower_id);
    delete from public.riftbound_loans where member in (lender_id, borrower_id);
    perform set_config('ni_han_bao.erase_loans', 'off', true);
    delete from public.riftbound_trade_matches where trader_id = member;
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
