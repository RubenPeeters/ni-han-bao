import {
  ActivityType,
  type ChatInputCommandInteraction,
  Client,
  type Collection,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  MessageFlags,
  type MessageReaction,
  Partials,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { channelRow, memberRow, shouldCount, utcDay, type MemberRow } from "./activity.js";
import { Backoff, flushUntil, InFlight } from "./backoff.js";
import { loadConfig } from "./config.js";
import { countsLive, loadBeforeId } from "./history.js";
import { createLogger } from "./log.js";
import { keyedQueue, memberFetchRetryMs, syncMembers } from "./membership.js";
import { nextPresence, PRESENCE_PHRASES } from "./presence.js";
import { emojiRow, receivesReaction } from "./reactions.js";
import {
  addDays,
  dueReportWeek,
  isReportFor,
  PAGE_SIZE,
  postedSince,
  reportEmbed,
  reportSlot,
  type ReportData,
} from "./report.js";
import {
  CHANNEL_DAYS,
  channelEmbed,
  leaderboardEmbed,
  meEmbed,
  rankOf,
  STATS_COMMANDS,
  sumSince,
  utcWeekStart,
  type Period,
} from "./stats.js";
import { flushServers, Server, type ServerWriter } from "./servers.js";
import { hiddenFor, setVisibility, VISIBILITY_COMMANDS } from "./visibility.js";

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 10_000;
// Docker stop waits 10 s after SIGTERM before it kills the container.
const SHUTDOWN_DEADLINE_MS = 8_000;
const SHUTDOWN_KILL_MS = 9_500;
const PRESENCE_MS = 5 * 60_000;
const REPORT_CHECK_MS = 60_000;

const config = loadConfig();
const log = createLogger();
// The secret key bypasses RLS: the bot is the only writer. Never ship it to the website.
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});

// No MessageContent intent on purpose: message events still arrive (enough for counting),
// but without their text, so the bot cannot store what people write.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Without these, reactions on messages sent before the bot (re)started are not emitted.
  partials: [Partials.Message, Partials.Reaction],
});

async function heartbeat(): Promise<void> {
  // Caught here: it runs from a timer, and an unhandled rejection would exit the bot.
  try {
    await writeHeartbeat();
  } catch (err) {
    log("error", "heartbeat_failed", { error: err });
  }
}

async function writeHeartbeat(): Promise<void> {
  // The cache is current: the Guilds and GuildMembers intents keep names and counts up to date.
  const guilds = [...client.guilds.cache.values()];
  if (!guilds.length) return;
  const now = new Date();
  const { error } = await db.from("bot_status").upsert(
    guilds.map((guild) => ({
      guild_id: guild.id,
      guild_name: guild.name,
      member_count: guild.memberCount,
      // Discord's CDN URL, so changing the avatar on Discord changes the site.
      avatar_url: client.user?.displayAvatarURL({ size: 256 }) ?? null,
      last_seen: now.toISOString(),
    })),
    { onConflict: "guild_id" },
  );
  if (error) log("error", "heartbeat_failed", { error: error.message });
  // Rewritten every heartbeat, so each day keeps the last count seen that day.
  const snapshot = await db.from("member_count_snapshots").upsert(
    guilds.map((guild) => ({
      guild_id: guild.id,
      day: utcDay(now),
      member_count: guild.memberCount,
      updated_at: now.toISOString(),
    })),
    { onConflict: "guild_id,day" },
  );
  if (snapshot.error) {
    log("error", "member_count_snapshot_failed", { error: snapshot.error.message });
  }
}

// Servers whose backfill boundary is known; events from any other server are not counted.
const servers = new Map<string, Server>();

let flushing: Promise<boolean> | null = null;
// Flushes and reaction lookups started before shutdown; they may still add or write counts.
const inFlight = new InFlight();

/** Writes for one server; every upsert names its conflict target, the composite key. */
function writerFor(guildId: string): ServerWriter {
  const upsertMembers = async (rows: MemberRow[]) => {
    const { error } = await db
      .from("members")
      .upsert(rows.map((r) => ({ ...r, guild_id: guildId, updated_at: new Date().toISOString() })), {
        onConflict: "guild_id,user_id",
      });
    if (error) throw new Error(`members upsert: ${error.message}`);
  };
  return {
    upsertMembers,
    async upsertChannels(rows) {
      const { error } = await db
        .from("channels")
        .upsert(rows.map((r) => ({ ...r, guild_id: guildId, updated_at: new Date().toISOString() })), {
          onConflict: "guild_id,channel_id",
        });
      if (error) throw new Error(`channels upsert: ${error.message}`);
    },
    async incrementCounts(batch) {
      const { error } = await db.rpc("increment_activity", {
        batch: batch.id,
        counts: batch.counts,
        channel_counts: batch.channelCounts,
        guild: guildId,
      });
      if (error) throw new Error(`increment_activity: ${error.message}`);
    },
    async incrementReactions(batch) {
      const { error } = await db.rpc("increment_reactions", {
        batch: batch.id,
        emojis: batch.emojis,
        emoji_counts: batch.emojiCounts,
        received_counts: batch.receivedCounts,
        guild: guildId,
      });
      if (error) throw new Error(`increment_reactions: ${error.message}`);
    },
    async incrementTimeline(batch) {
      const { error } = await db.rpc("increment_timeline", {
        batch: batch.id,
        flow: batch.flow,
        voice: batch.voice,
        guild: guildId,
      });
      if (error) throw new Error(`increment_timeline: ${error.message}`);
    },
  };
}

/** Logs each stream that failed and reports whether all of them were written. */
function flushAll(): Promise<boolean> {
  return flushServers(
    servers.values(),
    writerFor,
    (guild, stream, err) => log("warn", "flush_failed", { guild, stream, error: err }),
    new Date(),
  );
}

// One flush at a time, so shutdown can wait for the one in flight before writing the rest.
function flush(): Promise<boolean> {
  flushing ??= inFlight.track(
    flushAll().finally(() => {
      flushing = null;
    }),
  );
  return flushing;
}

const sum = <T>(rows: T[], value: (row: T) => number) => rows.reduce((n, r) => n + value(r), 0);

/** Totals for the log: what a retry carries, or what a shutdown could not write. */
function totals(
  counts: { count: number }[],
  emojiCounts: { count: number }[],
  flow: { joins: number; leaves: number }[],
  voiceRows: { seconds: number }[],
) {
  return {
    messages: sum(counts, (c) => c.count),
    reactions: sum(emojiCounts, (c) => c.count),
    joins: sum(flow, (f) => f.joins),
    leaves: sum(flow, (f) => f.leaves),
    voice_seconds: sum(voiceRows, (v) => v.seconds),
  };
}

/** Everything not yet written, over all servers: buffered counts plus failed batches. */
function unwritten() {
  const counts = [];
  const emojiCounts = [];
  const flow = [];
  const voiceRows = [];
  for (const { activity, reactions, timeline } of servers.values()) {
    // Drain and put straight back: restore into the emptied maps is exact, and nothing
    // can run between the two calls.
    const a = activity.drain();
    const r = reactions.drain();
    const t = timeline.drain();
    activity.restore(a);
    reactions.restore(r);
    timeline.restore(t);
    counts.push(...a.counts, ...(activity.pending?.counts ?? []));
    emojiCounts.push(...r.emojiCounts, ...(reactions.pending?.emojiCounts ?? []));
    flow.push(...t.flow, ...(timeline.pending?.flow ?? []));
    voiceRows.push(...t.voice, ...(timeline.pending?.voice ?? []));
  }
  return totals(counts, emojiCounts, flow, voiceRows);
}

// Failed writes stay buffered, so retrying later loses nothing; backing off spares a
// struggling database a request every 10 s.
const flushBackoff = new Backoff(FLUSH_MS, 5 * 60_000);

async function periodicFlush(): Promise<void> {
  if (stopping || !flushBackoff.ready(Date.now())) return;
  if (await flush()) {
    if (flushBackoff.failures) log("info", "flush_recovered", { failures: flushBackoff.failures });
    flushBackoff.succeed();
    return;
  }
  const delay = flushBackoff.fail(Date.now());
  log("warn", "flush_retry", { attempt: flushBackoff.failures, retry_in_ms: delay, ...unwritten() });
}

client.on(Events.MessageCreate, (message) => {
  const server = message.guildId ? servers.get(message.guildId) : undefined;
  if (!server) return;
  const counted = shouldCount(
    {
      guildId: message.guildId,
      authorIsBot: message.author.bot,
      webhookId: message.webhookId,
      system: message.system,
    },
    server.id,
  );
  // inGuild() is implied by shouldCount; it is here to narrow the channel type.
  if (!counted || !message.inGuild() || !countsLive(message.id, server.liveFrom)) return;
  const { channel } = message;
  const row = channelRow({
    id: channel.id,
    name: channel.name,
    parent: channel.isThread() ? channel.parent : null,
  });
  server.activity.addMessage(message.author.id, row.channel_id, message.createdAt);
  server.activity.setMember(memberRow(message.author, message.member));
  server.activity.setChannel(row);
});

// Removals are ignored on purpose (see ReactionBuffer), so there is no MessageReactionRemove.
client.on(Events.MessageReactionAdd, (reaction, user) => void inFlight.track(countReaction(reaction, user)));

async function countReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  const { message } = reaction;
  const server = message.guildId ? servers.get(message.guildId) : undefined;
  if (user.bot || !server) return;
  const emoji = emojiRow(reaction.emoji);
  if (!emoji) return;
  const at = new Date();
  server.reactions.addEmoji(emoji, at);
  try {
    // A partial message has no author yet. Fetching it is fine: without the MessageContent
    // intent its text comes back empty, and only the author is read from it.
    const full = message.partial ? await message.fetch() : message;
    const author = {
      id: full.author.id,
      guildId: full.guildId,
      authorIsBot: full.author.bot,
      webhookId: full.webhookId,
      system: full.system,
    };
    if (receivesReaction(author, user.id, server.id)) {
      server.reactions.addReceived(memberRow(full.author, full.member), at);
    }
  } catch (err) {
    log("error", "reaction_author_lookup_failed", { error: err });
  }
}

// Renames while the bot is offline are picked up by the channel's next message.
client.on(Events.ChannelUpdate, (_old, channel) => {
  if (channel.isDMBased() || channel.isThread()) return;
  servers.get(channel.guildId)?.activity.setChannel(channelRow({ id: channel.id, name: channel.name }));
});

client.on(Events.GuildMemberUpdate, (_old, member) => {
  if (!member.user.bot) servers.get(member.guild.id)?.activity.setMember(memberRow(member.user, member));
});

// Global name and avatar changes arrive only as UserUpdate: discord.js emits
// GuildMemberUpdate just for guild-level changes (nickname, guild avatar, roles).
client.on(Events.UserUpdate, (_old, user) => {
  if (user.bot) return;
  // The member cache is complete (fetched when counting starts, kept current by the
  // GuildMembers intent), so a miss means the user is not in that server and gets no row.
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(user.id);
    if (member) servers.get(guild.id)?.activity.setMember(memberRow(user, member));
  }
});

// Bots count here, unlike everywhere else: the member count the timeline shows is
// Discord's, which includes them, and joins minus leaves should add up to it.
client.on(Events.GuildMemberAdd, (member) => {
  servers.get(member.guild.id)?.timeline.addJoin(new Date());
  if (!member.user.bot) {
    void tracked("member_add", membership(member.guild.id, () => addMembers(member.guild.id, [member.id])));
  }
});

client.on(Events.GuildMemberRemove, (member) => {
  servers.get(member.guild.id)?.timeline.addLeave(new Date());
  void tracked("member_remove", membership(member.guild.id, () => removeMembers(member.guild.id, [member.id])));
});

async function tracked(event: string, work: Promise<unknown>): Promise<void> {
  // Caught here: these run from events, and an unhandled rejection would exit the bot.
  try {
    await work;
  } catch (err) {
    log("error", `${event}_failed`, { error: err });
  }
}

const membership = keyedQueue();

async function upsertGuild(guild: Guild): Promise<void> {
  const { error } = await db.from("guilds").upsert({
    guild_id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`guilds upsert: ${error.message}`);
}

async function addMembers(guildId: string, userIds: string[]): Promise<void> {
  const { error } = await db
    .from("guild_members")
    .upsert(userIds.map((user_id) => ({ guild_id: guildId, user_id })), { ignoreDuplicates: true });
  if (error) throw new Error(`guild_members upsert: ${error.message}`);
}

async function removeMembers(guildId: string, userIds: string[]): Promise<void> {
  const { error } = await db.from("guild_members").delete().eq("guild_id", guildId).in("user_id", userIds);
  if (error) throw new Error(`guild_members delete: ${error.message}`);
}

/** Every member of the server, retrying while Discord rate limits the request. */
async function fetchMembers(guild: Guild): Promise<Collection<string, GuildMember>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await guild.members.fetch();
    } catch (err) {
      const delay = memberFetchRetryMs(err, attempt);
      if (delay === null) throw err;
      log("warn", "membership_sync_retry", { guild: guild.id, attempt, retry_in_ms: delay });
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Full resync of one server: its row, then its member list diffed against what is stored.
 * Returns the fetched members, so startup needs no second (rate limited) fetch.
 */
function syncGuild(guild: Guild): Promise<Collection<string, GuildMember>> {
  return membership(guild.id, () => syncGuildNow(guild));
}

async function syncGuildNow(guild: Guild): Promise<Collection<string, GuildMember>> {
  await upsertGuild(guild);
  const members = await fetchMembers(guild);
  const result = await syncMembers(
    [...members.values()].filter((m) => !m.user.bot).map((m) => m.id),
    {
      async storedPage(from, to) {
        const { data, error } = await db
          .from("guild_members")
          .select("user_id")
          .eq("guild_id", guild.id)
          .order("user_id")
          .range(from, to);
        if (error) throw new Error(`guild_members select: ${error.message}`);
        return data.map((r) => r.user_id as string);
      },
      add: (ids) => addMembers(guild.id, ids),
      remove: (ids) => removeMembers(guild.id, ids),
    },
  );
  log("info", "membership_synced", { guild: guild.id, ...result });
  return members;
}

// Emitted after ready only for servers the bot joins; those it is already in start on ready.
client.on(Events.GuildCreate, (guild) => void startServer(guild));
client.on(Events.GuildUpdate, (_old, guild) => void tracked("guild_update", membership(guild.id, () => upsertGuild(guild))));

// Only when the bot leaves or is removed: discord.js reports an outage as GuildUnavailable.
// Counting stops because no more events arrive; what is buffered still gets written, and
// the server's stats stay.
client.on(Events.GuildDelete, (guild) => {
  const server = servers.get(guild.id);
  // Otherwise every flush would keep adding voice time for sessions nobody can end.
  server?.timeline.addVoice(server.voice.closeAll(new Date()));
  void tracked(
    "guild_delete",
    membership(guild.id, async () => {
      const members = await db.from("guild_members").delete().eq("guild_id", guild.id);
      if (members.error) throw new Error(`guild_members delete: ${members.error.message}`);
      const row = await db.from("guilds").delete().eq("guild_id", guild.id);
      if (row.error) throw new Error(`guilds delete: ${row.error.message}`);
    }),
  );
});

client.on(Events.VoiceStateUpdate, (_old, state) => {
  const server = servers.get(state.guild.id);
  if (!server) return;
  if (state.channelId === null) {
    // No member check on a leave: an uncached member must still close their session, and
    // a bot never has one to close.
    server.timeline.addVoice(server.voice.update(state.id, false, new Date()));
    return;
  }
  if (!state.member || state.member.user.bot) return;
  server.timeline.setMember(memberRow(state.member.user, state.member));
  server.voice.update(state.id, true, new Date());
});

// shortcut: rank needs every member's total, fetched via leaderboard() up to this many rows
// (and PostgREST's max-rows, 1000 by default); add a rank function if the server outgrows it.
const RANK_TOP = 1000;

async function leaderboard(guild: string, since: string | null, top: number) {
  const { data, error } = await db.rpc("leaderboard", { since, top, guild });
  if (error) throw new Error(`leaderboard: ${error.message}`);
  return data as { user_id: string; display_name: string; message_count: number }[];
}

// Reads only, from the tables and functions the website uses. The secret key bypasses RLS,
// so hidden members are filtered by leaderboard() itself, and /me can read the caller's own rows.
// Every answer is about the server the command was used in.
async function statsReply(interaction: ChatInputCommandInteraction<"cached">) {
  const guild = interaction.guildId;
  const weekStart = utcWeekStart(new Date());
  if (interaction.commandName === "leaderboard") {
    const period: Period = interaction.options.getString("period") === "all" ? "all" : "week";
    const rows = await leaderboard(guild, period === "week" ? weekStart : null, 10);
    return { embeds: [leaderboardEmbed(period, rows, weekStart, config.siteUrl)] };
  }
  if (interaction.commandName === "me") {
    const userId = interaction.user.id;
    const [counts, received, member, week, allTime] = await Promise.all([
      db.from("message_counts").select("day, count").eq("guild_id", guild).eq("user_id", userId),
      db.from("reactions_received").select("day, count").eq("guild_id", guild).eq("user_id", userId),
      db.from("members").select("hidden").eq("guild_id", guild).eq("user_id", userId).maybeSingle(),
      leaderboard(guild, weekStart, RANK_TOP),
      leaderboard(guild, null, RANK_TOP),
    ]);
    for (const r of [counts, received, member]) if (r.error) throw new Error(`/me: ${r.error.message}`);
    const weekCount = sumSince(counts.data ?? [], weekStart);
    const allTimeCount = sumSince(counts.data ?? [], null);
    const stats = {
      displayName: memberRow(interaction.user, interaction.member).display_name,
      week: weekCount,
      allTime: allTimeCount,
      weekRank: rankOf(week, userId, weekCount),
      allTimeRank: rankOf(allTime, userId, allTimeCount),
      reactionsReceived: sumSince(received.data ?? [], null),
      hidden: member.data?.hidden ?? false,
    };
    return { embeds: [meEmbed(stats, config.siteUrl)] };
  }
  const picked = interaction.options.getChannel("channel") ?? interaction.channel;
  // Thread messages are counted toward their parent channel (see channelRow).
  const target = picked?.isThread() ? (picked.parent ?? picked) : picked;
  if (!target) return { content: "Pick a channel to look at." };
  const { data, error } = await db
    .from("channel_message_counts")
    .select("hour, count")
    .eq("guild_id", guild)
    .eq("channel_id", target.id)
    .gte("hour", new Date(Date.now() - CHANNEL_DAYS * 24 * 60 * 60_000).toISOString());
  if (error) throw new Error(`channel_message_counts: ${error.message}`);
  return { embeds: [channelEmbed(target.name, data, config.siteUrl)] };
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  if (STATS_COMMANDS.some((c) => c.name === interaction.commandName)) {
    try {
      // /me is ephemeral: a hidden member's own stats must not show up for everyone.
      await interaction.deferReply(
        interaction.commandName === "me" ? { flags: MessageFlags.Ephemeral } : {},
      );
      const reply = await statsReply(interaction).catch((err: unknown) => {
        log("error", "command_failed", { command: interaction.commandName, error: err });
        return "Could not load the stats. Please try again later.";
      });
      await interaction.editReply(reply);
    } catch (err) {
      log("error", "command_failed", { command: interaction.commandName, error: err });
    }
    return;
  }
  const hidden = hiddenFor(interaction.commandName);
  if (hidden === null) return;
  try {
    // Deferred because Discord drops replies sent more than 3 s in, and the write may be slow.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = await setVisibility(
      {
        async setHidden(row, flag) {
          // Upsert so a member who has never posted still gets a row to carry the flag.
          const { error } = await db.from("members").upsert(
            { ...row, guild_id: interaction.guildId, hidden: flag, updated_at: new Date().toISOString() },
            { onConflict: "guild_id,user_id" },
          );
          if (error) throw new Error(`members upsert: ${error.message}`);
        },
      },
      memberRow(interaction.user, interaction.member),
      hidden,
    );
    await interaction.editReply(reply);
  } catch (err) {
    log("error", "command_failed", { command: interaction.commandName, error: err });
  }
});

let presenceIndex = 0;

async function rotatePresence(): Promise<void> {
  // Caught here: it runs from a timer, and an unhandled rejection would exit the bot.
  try {
    // One status for all servers, so the numbers are totals over them.
    const guilds = [...client.guilds.cache.values()];
    const perServer = await Promise.all(
      guilds.map(async (guild) => {
        // shortcut: messages today are summed over at most 1000 channels per server; fine for small servers.
        const { data, error } = await db.rpc("busiest_channels", {
          since: `${utcDay(new Date())}T00:00:00Z`,
          top: 1000,
          guild: guild.id,
        });
        if (error) throw new Error(`busiest_channels: ${error.message}`);
        return data as { name: string; message_count: number }[];
      }),
    );
    const next = nextPresence(PRESENCE_PHRASES, presenceIndex, {
      messagesToday: sum(perServer.flat(), (r) => r.message_count),
      // A channel name only with a single server: the status shows in every server.
      busiestChannel: perServer.length === 1 ? (perServer[0][0]?.name ?? null) : null,
      members: sum(guilds, (g) => g.memberCount),
    });
    if (!next) return;
    presenceIndex = next.next;
    await client.user?.setActivity({ type: ActivityType.Custom, name: next.text, state: next.text });
  } catch (err) {
    log("warn", "presence_failed", { error: err });
  }
}

// Week last seen posted, so the database is asked once per week rather than every check.
let reportedWeek: string | null = null;
let reporting = false;

async function weeklyReport(): Promise<void> {
  const channelId = config.reportChannelId;
  const week = dueReportWeek(new Date());
  if (!channelId || week === null || week === reportedWeek || reporting) return;
  reporting = true;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable() || channel.isDMBased()) {
      throw new Error("REPORT_CHANNEL_ID is not a server channel the bot can post in");
    }
    // The report is about the channel's own server (The Think Tank); other servers get none
    // until the channel is configurable per server.
    const guild = channel.guildId;
    const recorded = await db
      .from("report_cards")
      .select("week")
      .eq("guild_id", guild)
      .eq("week", week)
      .maybeSingle();
    if (recorded.error) throw new Error(`report_cards select: ${recorded.error.message}`);
    if (recorded.data) {
      reportedWeek = week;
      return;
    }
    // The channel, not the table, decides whether the week went out: a send whose response
    // was lost, or a crash before the row below was written, must not post it twice.
    // Searched back to the slot: Discord's nonce check only covers the last few minutes.
    // A minute earlier than the slot, in case Discord's clock is behind ours.
    const posted = await postedSince(
      async (before) => [
        ...(await channel.messages.fetch(before ? { limit: PAGE_SIZE, before } : { limit: PAGE_SIZE })).values(),
      ],
      reportSlot(new Date()).getTime() - 60_000,
      (m) => m.author.id === client.user?.id && isReportFor(m.embeds, week),
    );
    if (!posted) {
      const { data, error } = await db.rpc("report_card", {
        since: week,
        until: addDays(week, 7),
        guild,
      });
      if (error) throw new Error(`report_card: ${error.message}`);
      // The nonce makes Discord drop a second send of the same week from a concurrent bot.
      await channel.send({
        embeds: [reportEmbed(week, data as ReportData, config.siteUrl)],
        nonce: `report-${week}`,
        enforceNonce: true,
      });
    }
    const record = await db
      .from("report_cards")
      .upsert({ guild_id: guild, week }, { onConflict: "guild_id,week", ignoreDuplicates: true });
    if (record.error) throw new Error(`report_cards upsert: ${record.error.message}`);
    reportedWeek = week;
    log("info", "report_posted", { guild, week });
  } catch (err) {
    log("error", "report_failed", { week, error: err });
  } finally {
    reporting = false;
  }
}

/**
 * Starts counting in one server: on ready for each server the bot is in, and on GuildCreate
 * for one it joins, so a new server needs no restart.
 */
async function startServer(guild: Guild): Promise<void> {
  // Guild commands, not global ones: they apply instantly.
  try {
    await guild.commands.set([...VISIBILITY_COMMANDS, ...STATS_COMMANDS]);
  } catch (err) {
    log("error", "command_registration_failed", { guild: guild.id, error: err });
  }
  if (!servers.has(guild.id)) {
    // Not caught: a server without its boundary goes uncounted, so the rejection is fatal and
    // Docker restarts the bot to try again.
    const liveFrom = await loadBeforeId(db, guild.id);
    if (!servers.has(guild.id)) servers.set(guild.id, new Server(guild.id, liveFrom));
    log("info", "live_counting_from", { guild: guild.id, before_id: liveFrom });
  }
  const server = servers.get(guild.id)!;
  let members: Collection<string, GuildMember> | undefined;
  try {
    members = await syncGuild(guild);
  } catch (err) {
    log("error", "membership_sync_failed", { guild: guild.id, error: err });
  }
  // Names and avatars may have changed while the bot was offline (or out of the server).
  try {
    for (const member of members?.values() ?? []) {
      if (!member.user.bot) server.activity.setMember(memberRow(member.user, member));
    }
    // Whoever was in voice before counting started is counted from now on.
    const inVoice = [...guild.voiceStates.cache.values()].flatMap((s) =>
      s.channelId !== null && s.member && !s.member.user.bot ? [s.member] : [],
    );
    for (const m of inVoice) server.timeline.setMember(memberRow(m.user, m));
    server.timeline.addVoice(server.voice.sync(inVoice.map((m) => m.id), new Date()));
  } catch (err) {
    log("error", "member_sync_failed", { guild: guild.id, error: err });
  }
}

client.once(Events.ClientReady, async (c) => {
  log("info", "ready", { user: c.user.tag, servers: c.guilds.cache.size });
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  setInterval(() => void periodicFlush(), FLUSH_MS);
  void rotatePresence();
  setInterval(() => void rotatePresence(), PRESENCE_MS);
  if (config.reportChannelId) {
    void weeklyReport();
    setInterval(() => void weeklyReport(), REPORT_CHECK_MS);
  }
  for (const guild of c.guilds.cache.values()) await startServer(guild);
});

// discord.js reconnects by itself; these only make outages visible in the log.
client.on(Events.ShardReconnecting, (shard) => log("warn", "discord_reconnecting", { shard }));
client.on(Events.ShardResume, (shard, replayed) => log("info", "discord_resumed", { shard, replayed }));
client.on(Events.ShardReady, (shard) => log("info", "discord_shard_ready", { shard }));
client.on(Events.ShardError, (error, shard) => log("error", "discord_error", { shard, error }));
client.on(Events.Warn, (message) => log("warn", "discord_warn", { message }));
// Without a listener, an emitted "error" would throw and crash the bot.
client.on(Events.Error, (error) => log("error", "discord_error", { error }));
// Emitted only when discord.js has given up reconnecting: exit so Docker restarts us.
client.on(Events.ShardDisconnect, (event, shard) => {
  log("error", "discord_disconnected", { shard, code: event.code });
  void shutdown(1);
});

let stopping = false;

async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = Date.now() + SHUTDOWN_DEADLINE_MS;
  log("info", "shutdown", { code });
  // A write can hang with no timeout of its own; exit before Docker's SIGKILL either way.
  setTimeout(() => {
    // A hung write holds its drained batch where unwritten() cannot see it, so `lost` is
    // then a lower bound.
    log("error", "shutdown_timeout", { flush_in_flight: flushing !== null, lost: unwritten() });
    process.exit(code);
  }, SHUTDOWN_KILL_MS);
  // Stop new events first, then let work in flight finish: a flush drained the buffers before
  // anything it missed arrived, and a reaction lookup may still add a count.
  await client.destroy();
  await inFlight.settle();
  // Close open voice sessions now, so the next start does not have to guess when they ended.
  for (const { timeline, voice } of servers.values()) timeline.addVoice(voice.closeAll(new Date()));
  const clock = {
    now: Date.now,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  const ok = await flushUntil(flush, deadline, new Backoff(500, 2000), clock, (attempt, delay) =>
    log("warn", "flush_retry", { attempt, retry_in_ms: delay, ...unwritten() }),
  );
  if (ok) log("info", "flushed");
  else log("error", "flush_lost", { lost: unwritten() });
  process.exit(code);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

// Non-zero exit, so the unless-stopped restart policy brings the bot back.
function fatal(event: string, error: unknown): void {
  log("fatal", event, { error });
  // Failing again while shutting down: the flush itself may be what broke, so stop now.
  if (stopping) process.exit(1);
  void shutdown(1);
}
process.on("unhandledRejection", (reason) => fatal("unhandled_rejection", reason));
process.on("uncaughtException", (error) => fatal("uncaught_exception", error));

// Every stored boundary, before login, so no message in a server counted before is missed
// while startServer gets to it. A server without one has never been counted: its boundary is
// then the moment startServer stores it (see backfillBefore), and earlier messages are the
// backfill's. Throws (and Docker retries) when the database is unreachable.
// shortcut: PostgREST returns at most 1000 rows; beyond that many servers, page this.
const { data: boundaries, error: boundariesError } = await db.from("backfill_state").select("guild_id, before_id");
if (boundariesError) throw new Error(`backfill_state: ${boundariesError.message}`);
for (const b of boundaries) servers.set(b.guild_id, new Server(b.guild_id, b.before_id));
await client.login(config.discordToken);
