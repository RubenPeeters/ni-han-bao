-- Languages I accept when borrowing (#298): a preference for Who has it?, never a rules
-- warning (mixing official languages is legal, #169). Additive: the default is English only.
alter table public.profiles
    add column if not exists borrow_languages public.riftbound_language[] not null default '{en}'
        check (cardinality(borrow_languages) > 0);

-- Settings: the caller's own row only. The domain rejects an unknown language.
create function public.set_borrow_languages(p_languages text[])
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
    if coalesce(cardinality(p_languages), 0) = 0 then
        raise exception 'pick at least one language';
    end if;
    insert into public.profiles (user_id, borrow_languages) values (me, p_languages::public.riftbound_language[])
    on conflict (user_id) do update set borrow_languages = excluded.borrow_languages, updated_at = now();
    if not found then
        raise exception 'you asked to be forgotten: use /show-me in Discord first';
    end if;
end;
$$;

revoke execute on function public.set_borrow_languages(text[]) from public, anon;
grant execute on function public.set_borrow_languages(text[]) to authenticated;
