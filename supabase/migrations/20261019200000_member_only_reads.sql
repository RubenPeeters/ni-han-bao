-- Multi-server, part 5: per-server data is readable only by members of that server. Not
-- backwards compatible on purpose: anon loses read access to every per-server table, so the
-- logged-out site keeps only public_totals() (security definer). Checked by
-- scripts/check-rls.sql. applied_count_batches holds batch ids only and stays as it is.

drop policy "public read" on public.guilds;
create policy "members read" on public.guilds for select to authenticated
    using (public.is_guild_member(guild_id));

-- is_guild_member() is security definer, so this policy does not recurse into itself.
drop policy "public read" on public.guild_members;
create policy "members read" on public.guild_members for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.bot_status;
create policy "members read" on public.bot_status for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.channels;
create policy "members read" on public.channels for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.channel_message_counts;
create policy "members read" on public.channel_message_counts for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.emojis;
create policy "members read" on public.emojis for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.emoji_counts;
create policy "members read" on public.emoji_counts for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.member_count_snapshots;
create policy "members read" on public.member_count_snapshots for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.member_flow;
create policy "members read" on public.member_flow for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.report_cards;
create policy "members read" on public.report_cards for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.backfill_state;
create policy "members read" on public.backfill_state for select to authenticated
    using (public.is_guild_member(guild_id));

drop policy "public read" on public.backfill_cursors;
create policy "members read" on public.backfill_cursors for select to authenticated
    using (public.is_guild_member(guild_id));

-- The opt-out stays: hidden members and their per-member rows are still left out. The
-- hidden check now matches on guild_id too, since hiding is per server.
drop policy "public read" on public.members;
create policy "members read" on public.members for select to authenticated
    using (public.is_guild_member(guild_id) and not hidden);

drop policy "public read" on public.message_counts;
create policy "members read" on public.message_counts for select to authenticated using (
    public.is_guild_member(guild_id) and exists (
        select from public.members m
        where m.guild_id = message_counts.guild_id and m.user_id = message_counts.user_id and not m.hidden
    )
);

drop policy "public read" on public.reactions_received;
create policy "members read" on public.reactions_received for select to authenticated using (
    public.is_guild_member(guild_id) and exists (
        select from public.members m
        where m.guild_id = reactions_received.guild_id and m.user_id = reactions_received.user_id
            and not m.hidden
    )
);

drop policy "public read" on public.voice_seconds;
create policy "members read" on public.voice_seconds for select to authenticated using (
    public.is_guild_member(guild_id) and exists (
        select from public.members m
        where m.guild_id = voice_seconds.guild_id and m.user_id = voice_seconds.user_id and not m.hidden
    )
);

drop policy "public read" on public.member_channel_counts;
create policy "members read" on public.member_channel_counts for select to authenticated using (
    public.is_guild_member(guild_id) and exists (
        select from public.members m
        where m.guild_id = member_channel_counts.guild_id and m.user_id = member_channel_counts.user_id
            and not m.hidden
    )
);

drop policy "public read" on public.member_emoji_counts;
create policy "members read" on public.member_emoji_counts for select to authenticated using (
    public.is_guild_member(guild_id) and exists (
        select from public.members m
        where m.guild_id = member_emoji_counts.guild_id and m.user_id = member_emoji_counts.user_id
            and not m.hidden
    )
);
