-- Settings, My data (#352): everything stored about the visitor, as one JSON document they
-- download. Read only and additive: no table, no write path.
--
-- Security definer: several of these tables have no policies, or leave hidden rows out, so the
-- visitor could not read their own rows. Every row is the caller's own (current_discord_id()),
-- or a shared row they are a party to (a loan, a borrow request, a trade match), where the other
-- member is only a display name: from a server they are not hidden in, null when hidden
-- everywhere. Whole rows go through to_jsonb() minus the ids that point at a member, so a column
-- added later is in the export without changing this. Null when logged out.
create or replace function public.my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'exported_at', now(),
        'discord_id', me.id,
        'profile', jsonb_build_object(
            'settings', (select to_jsonb(p) - 'user_id' from public.profiles p where p.user_id = me.id),
            'forgotten_at', (select f.forgotten_at from public.forgotten_users f where f.user_hash = public.user_hash(me.id)),
            'riftbound_ten_copies', (select to_jsonb(t) - 'user_id' from public.riftbound_ten_copies t where t.user_id = me.id)
        ),
        -- Every server something is stored for, also ones the visitor has left.
        'servers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'guild_id', s.guild_id,
                'name', g.name,
                'member', (select to_jsonb(m) - 'user_id' - 'guild_id' from public.members m where m.guild_id = s.guild_id and m.user_id = me.id),
                'membership', (select to_jsonb(gm) - 'user_id' - 'guild_id' from public.guild_members gm where gm.guild_id = s.guild_id and gm.user_id = me.id),
                'onboarding', (select to_jsonb(o) - 'user_id' - 'guild_id' from public.onboarding_dms o where o.guild_id = s.guild_id and o.user_id = me.id),
                'messages', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'count', c.count) order by c.day)
                    from public.message_counts c where c.guild_id = s.guild_id and c.user_id = me.id), '[]'),
                'messages_per_channel', coalesce((select jsonb_agg(jsonb_build_object('channel_id', c.channel_id, 'channel', ch.name, 'day', c.day, 'count', c.count) order by c.day, c.channel_id)
                    from public.member_channel_counts c
                    left join public.channels ch on ch.guild_id = c.guild_id and ch.channel_id = c.channel_id
                    where c.guild_id = s.guild_id and c.user_id = me.id), '[]'),
                'reactions_received', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'count', c.count) order by c.day)
                    from public.reactions_received c where c.guild_id = s.guild_id and c.user_id = me.id), '[]'),
                'emoji', coalesce((select jsonb_agg(jsonb_build_object('emoji_key', c.emoji_key, 'emoji', e.name, 'day', c.day, 'count', c.count) order by c.day, c.emoji_key)
                    from public.member_emoji_counts c
                    left join public.emojis e on e.guild_id = c.guild_id and e.emoji_key = c.emoji_key
                    where c.guild_id = s.guild_id and c.user_id = me.id), '[]'),
                'voice_seconds', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'seconds', c.seconds) order by c.day)
                    from public.voice_seconds c where c.guild_id = s.guild_id and c.user_id = me.id), '[]')
            ) order by g.name, s.guild_id)
            from (
                select x.guild_id from public.guild_members x where x.user_id = me.id
                union select x.guild_id from public.members x where x.user_id = me.id
                union select x.guild_id from public.onboarding_dms x where x.user_id = me.id
            ) s
            left join public.guilds g on g.guild_id = s.guild_id
        ), '[]'),
        'game_time', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.day, a.kind, a.name)
            from public.activity_seconds a where a.user_id = me.id), '[]'),
        'game_accounts', coalesce((
            select jsonb_agg(to_jsonb(a) - 'user_id' || jsonb_build_object(
                'ranks', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' - 'game' order by r.queue)
                    from public.lol_ranks r where r.user_id = me.id and r.game = a.game), '[]'),
                'rank_changes', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' - 'game' order by r.changed_at)
                    from public.lol_rank_changes r where r.user_id = me.id and r.game = a.game), '[]'),
                'games', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'game' order by x.played_at)
                    from public.lol_matches x where x.user_id = me.id and x.game = a.game), '[]')
            ) order by a.game)
            from public.game_accounts a where a.user_id = me.id
        ), '[]'),
        'riftbound_collection', jsonb_build_object(
            'cards', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' || jsonb_build_object('card', rc.name, 'code', p.collector_code)
                    order by c.printing_id, c.finish, c.condition, c.language)
                from public.riftbound_collection c
                join public.riftbound_printings p on p.id = c.printing_id
                join public.riftbound_cards rc on rc.id = p.card_id
                where c.user_id = me.id), '[]'),
            'activity', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.day)
                from public.riftbound_collection_activity a where a.user_id = me.id), '[]'),
            'playset_goals', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id' order by g.set_code)
                from public.riftbound_playset_goals g where g.user_id = me.id), '[]')
        ),
        'riftbound_decks', coalesce((
            select jsonb_agg(to_jsonb(d) - 'user_id' || jsonb_build_object(
                'cards', coalesce((select jsonb_agg(to_jsonb(c) - 'deck_id' order by c.section, c.card_id, c.printing_id)
                    from public.riftbound_deck_cards c where c.deck_id = d.id), '[]'),
                'versions', coalesce((select jsonb_agg(to_jsonb(v) - 'deck_id' order by v.version)
                    from public.riftbound_deck_versions v where v.deck_id = d.id), '[]')
            ) order by d.created_at, d.id)
            from public.riftbound_decks d where d.user_id = me.id
        ), '[]'),
        -- Decks opened by their link: only the deck's id, which may be another member's.
        'riftbound_decks_opened', coalesce((select jsonb_agg(to_jsonb(o) - 'user_id' order by o.opened_at)
            from public.riftbound_deck_opens o where o.user_id = me.id), '[]'),
        'riftbound_wishlist', coalesce((select jsonb_agg(to_jsonb(w) - 'user_id' || jsonb_build_object('card', rc.name)
                order by rc.name, w.printing_id)
            from public.riftbound_wishlist w
            join public.riftbound_cards rc on rc.id = w.card_id
            where w.user_id = me.id), '[]'),
        'riftbound_loans', coalesce((
            select jsonb_agg(to_jsonb(l) - 'lender_id' - 'borrower_id' || jsonb_build_object(
                'role', case when l.lender_id = me.id then 'lender' else 'borrower' end,
                'other', (select x.display_name from public.members x
                    where x.user_id = case when l.lender_id = me.id then l.borrower_id else l.lender_id end and not x.hidden
                    order by x.updated_at desc limit 1),
                'cards', coalesce((select jsonb_agg(to_jsonb(c) - 'loan_id' || jsonb_build_object('card', rc.name, 'code', p.collector_code)
                        order by c.printing_id, c.finish, c.condition, c.language)
                    from public.riftbound_loan_cards c
                    join public.riftbound_printings p on p.id = c.printing_id
                    join public.riftbound_cards rc on rc.id = p.card_id
                    where c.loan_id = l.id), '[]'),
                'entries', coalesce((select jsonb_agg(to_jsonb(e) - 'loan_id' - 'by_id' || jsonb_build_object(
                        'by', case when e.by_id is null then 'bot' when e.by_id = me.id then 'me' else 'other' end) order by e.id)
                    from public.riftbound_loan_entries e where e.loan_id = l.id), '[]')
            ) order by l.id)
            from public.riftbound_loans l where me.id in (l.lender_id, l.borrower_id)
        ), '[]'),
        'riftbound_borrow_requests', coalesce((
            select jsonb_agg(to_jsonb(r) - 'lender_id' - 'borrower_id' || jsonb_build_object(
                'role', case when r.lender_id = me.id then 'lender' else 'borrower' end,
                'other', (select x.display_name from public.members x
                    where x.user_id = case when r.lender_id = me.id then r.borrower_id else r.lender_id end and not x.hidden
                    order by x.updated_at desc limit 1),
                'cards', coalesce((select jsonb_agg(to_jsonb(c) - 'request_id' || jsonb_build_object('card', rc.name) order by c.card_id)
                    from public.riftbound_borrow_request_cards c
                    join public.riftbound_cards rc on rc.id = c.card_id
                    where c.request_id = r.id), '[]'),
                'answer', (select to_jsonb(a) - 'request_id' from public.riftbound_borrow_request_answers a where a.request_id = r.id),
                -- Only the bot's messages to the visitor.
                'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'request_id' order by m.sent_at)
                    from public.riftbound_borrow_request_dms m
                    where m.request_id = r.id and m.recipient = case when r.lender_id = me.id then 'lender' else 'borrower' end), '[]')
            ) order by r.id)
            from public.riftbound_borrow_requests r where me.id in (r.lender_id, r.borrower_id)
        ), '[]'),
        'riftbound_trade_matches', coalesce((
            select jsonb_agg(jsonb_build_object(
                'role', case when t.user_id = me.id then 'wants' else 'trades' end,
                'other', (select x.display_name from public.members x
                    where x.user_id = case when t.user_id = me.id then t.trader_id else t.user_id end and not x.hidden
                    order by x.updated_at desc limit 1),
                'card_id', t.card_id, 'card', rc.name, 'notified_at', t.notified_at
            ) order by t.notified_at, t.card_id)
            from public.riftbound_trade_matches t
            join public.riftbound_cards rc on rc.id = t.card_id
            where me.id in (t.user_id, t.trader_id)
        ), '[]'),
        'stores', jsonb_build_object(
            'added', coalesce((select jsonb_agg(to_jsonb(s) - 'added_by' order by s.id)
                from public.stores s where s.added_by = me.id), '[]'),
            'regular_at', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' || jsonb_build_object('store', s.name, 'city', s.city) order by r.created_at)
                from public.store_regulars r
                join public.stores s on s.id = r.store_id
                where r.user_id = me.id), '[]')
        ),
        'events', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' || jsonb_build_object('event', e.name, 'starts_at', e.starts_at, 'store', s.name)
                order by e.starts_at, e.id)
            from public.event_attendees a
            join public.events e on e.id = a.event_id
            left join public.stores s on s.id = e.store_id
            where a.user_id = me.id), '[]')
    )
    from (select public.current_discord_id() as id) me
    where me.id is not null;
$$;

revoke execute on function public.my_data() from public, anon;
grant execute on function public.my_data() to authenticated;
