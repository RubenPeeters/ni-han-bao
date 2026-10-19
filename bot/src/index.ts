import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  type Collection,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type GuildScheduledEvent,
  MessageFlags,
  type MessageReaction,
  Partials,
  type PartialMessageReaction,
  type PartialUser,
  PermissionFlagsBits,
  type TextChannel,
  type User,
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { FORGET_CANCEL_ID, FORGET_COMMAND, FORGET_CONFIRM_ID, FORGET_PROMPT, forgetMe } from "./forget.js";
import { channelRow, memberRow, shouldCount, type MemberRow } from "./activity.js";
import {
  EVENT_COMMAND,
  allSubscriberIds,
  eventChoices,
  SUBSCRIBER_PAGE,
  goingEventId,
  goingId,
  goingText,
  eventLabel,
  matchStore,
  parseWhen,
  unticked,
  type UpcomingEvent,
} from "./events.js";
import { Backoff, flushUntil, InFlight } from "./backoff.js";
import { flushGames, gameApps, GameBuffer, gameKeys, GameSessions } from "./games.js";
import { loadConfig } from "./config.js";
import { countsLive, loadBeforeId } from "./history.js";
import { createLogger } from "./log.js";
import { keyedQueue, memberFetchRetryMs, readAll, syncMembers } from "./membership.js";
import { dueRecapMonth, isRecapFor, lastMonth, RECAP_COMMAND, recapMessage, recapNonce, recapSlot, recapUrls } from "./recap.js";
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
  type LeagueWeek,
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
  type Period,
} from "./stats.js";
import { backfillGuild } from "./server-history.js";
import { flushServers, Server, type ServerWriter } from "./servers.js";
import {
  canRemove,
  httpsUrl,
  LINK_ERROR,
  newStore,
  STORE_COMMAND,
  storeChoices,
  storeLabel,
  storeList,
  type Store,
} from "./stores.js";
import { challengeText, GAME, LOL_COMMAND, startLink, verifyLink, type Platform, type RiotLookup } from "./lol.js";
import { PROFILE_COMMAND, setProfileVisibility } from "./profile.js";
import { KEEP_MS, MATCH_TYPES, allIds, matchIdsPath, matchRegion, matchRow, type Match, type MatchRow } from "./matches.js";
import { rankRolesProblem, rankRows, roleChanges, roleTier, TIERS, tierName, type LeagueEntry } from "./ranks.js";
import { RiotApi } from "./riot.js";
import { CARD_COMMAND, cardChoices, cardEmbed, cardMiss, lookupCard, type Catalogue } from "./riftbound.js";
import { applySetup, DEFAULT_SETTINGS, SETUP_COMMAND, setupChange, type GuildSettings } from "./setup.js";
import { hiddenFor, setVisibility, VISIBILITY_COMMANDS } from "./visibility.js";
import { postWelcome, welcomeChannel, welcomeText } from "./welcome.js";
import { dayStart, fromWallClock, localDay, weekStart } from "./zone.js";

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 10_000;
// Docker stop waits 10 s after SIGTERM before it kills the container.
const SHUTDOWN_DEADLINE_MS = 8_000;
const SHUTDOWN_KILL_MS = 9_500;
const PRESENCE_MS = 5 * 60_000;
const REPORT_CHECK_MS = 60_000;
const RANKS_MS = 3 * 60 * 60_000;
const MATCHES_MS = 6 * 60 * 60_000;

const config = loadConfig();
const log = createLogger();
// The secret key bypasses RLS: the bot is the only writer. Never ship it to the website.
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});

const riot = config.riotApiKey ? new RiotApi(config.riotApiKey) : null;

// No MessageContent intent on purpose: message events still arrive (enough for counting),
// but without their text, so the bot cannot store what people write.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    // Not privileged: the server's Discord events and who clicked Interested (#115).
    GatewayIntentBits.GuildScheduledEvents,
    // Privileged: must be switched on in the Developer Portal, or login fails (#97). Only the
    // type and name of an activity are read, for game time (#101).
    GatewayIntentBits.GuildPresences,
  ],
  // Without these, reactions on messages sent before the bot (re)started are not emitted,
  // nor Interested clicks on an event the cache does not hold.
  partials: [Partials.Message, Partials.Reaction, Partials.GuildScheduledEvent],
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
      day: localDay(now, settingsFor(guild.id).timezone),
      member_count: guild.memberCount,
      updated_at: now.toISOString(),
    })),
    { onConflict: "guild_id,day" },
  );
  if (snapshot.error) {
    log("error", "member_count_snapshot_failed", { error: snapshot.error.message });
  }
}

// Every server's /setup row, loaded before login and kept current by /setup.
const settings = new Map<string, GuildSettings>();
const settingsFor = (guildId: string) => settings.get(guildId) ?? DEFAULT_SETTINGS;

// Servers whose backfill boundary is known; events from any other server are not counted.
const servers = new Map<string, Server>();
// Days are counted in the zone set now, so a /setup timezone change applies from then on.
const newServer = (id: string, liveFrom: string) => new Server(id, liveFrom, () => settingsFor(id).timezone);

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
        member_channel_counts: batch.memberChannelCounts,
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
        member_emoji_counts: batch.memberEmojiCounts,
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

// Game time is per user across servers (#101), so it is kept and written outside `servers`.
const games = new GameSessions();
const gameBuffer = new GameBuffer();

/** Logs each stream that failed and reports whether all of them were written. */
async function flushAll(): Promise<boolean> {
  const now = new Date();
  const ok = await flushServers(
    servers.values(),
    writerFor,
    (guild, stream, err) => log("warn", "flush_failed", { guild, stream, error: err }),
    now,
  );
  gameBuffer.add(games.collect(now));
  try {
    await flushGames(gameBuffer, {
      async incrementGames(batch) {
        const { error } = await db.rpc("increment_games", { batch: batch.id, games: batch.games });
        if (error) throw new Error(`increment_games: ${error.message}`);
      },
    });
  } catch (err) {
    log("warn", "flush_failed", { stream: "games", error: err });
    return false;
  }
  return ok;
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
  return { ...totals(counts, emojiCounts, flow, voiceRows), game_seconds: gameBuffer.seconds };
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
  // The member cache is complete (see UserUpdate), so a miss is someone no longer in the server.
  const reactor = message.guild?.members.cache.get(user.id);
  server.reactions.addEmoji(emoji, at, reactor ? memberRow(reactor.user, reactor) : null);
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
  gameBuffer.add(games.closeUnless((u) => u !== member.id || sharesServer(u), new Date()));
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
client.on(Events.GuildCreate, (guild) => {
  void startServer(guild);
  void tracked("welcome", welcome(guild));
});
async function welcome(guild: Guild): Promise<void> {
  const me = guild.members.me;
  const canSend = (c: TextChannel) =>
    !!me && !!c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  const channels = [...guild.channels.cache.values()]
    .filter((c): c is TextChannel => c.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const channel = welcomeChannel(guild.systemChannel, channels, canSend);
  const result = await postWelcome(
    {
      async claim(channelId) {
        const { data, error } = await db
          .from("welcome_messages")
          .upsert({ guild_id: guild.id, channel_id: channelId }, { onConflict: "guild_id", ignoreDuplicates: true })
          .select("guild_id");
        if (error) throw new Error(`welcome_messages upsert: ${error.message}`);
        return data.length > 0;
      },
      async release() {
        const { error } = await db.from("welcome_messages").delete().eq("guild_id", guild.id);
        if (error) throw new Error(`welcome_messages delete: ${error.message}`);
      },
    },
    channel,
    welcomeText(config.siteUrl, guild.id),
  );
  log(result === "no_channel" ? "warn" : "info", `welcome_${result}`, { guild: guild.id, channel: channel?.id });
}

client.on(Events.GuildUpdate, (_old, guild) => void tracked("guild_update", membership(guild.id, () => upsertGuild(guild))));

// Only when the bot leaves or is removed: discord.js reports an outage as GuildUnavailable.
// Counting stops because no more events arrive; what is buffered still gets written, and
// the server's stats stay.
client.on(Events.GuildDelete, (guild) => {
  const server = servers.get(guild.id);
  // Otherwise every flush would keep adding voice time for sessions nobody can end.
  server?.timeline.addVoice(server.voice.closeAll(new Date()));
  gameBuffer.add(games.closeUnless(sharesServer, new Date()));
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

// discord.js drops the member or guild from its cache before emitting the leave or delete.
const sharesServer = (userId: string) => client.guilds.cache.some((g) => g.members.cache.has(userId));

// Arrives once per shared server; GameSessions counts the user once. Offline presences have no activities.
client.on(Events.PresenceUpdate, (_old, presence) => {
  if (presence.user?.bot) return;
  gameBuffer.add(games.update(presence.userId, gameKeys(presence.activities), new Date()));
  for (const [name, id] of gameApps(presence.activities)) {
    if (gameIconsLooked.has(name)) continue;
    gameIconsLooked.add(name);
    void storeGameIcon(name, id);
  }
});

// Game names whose icon this process already looked up: once per game per run, the games
// table is the cache the site reads (#141).
const gameIconsLooked = new Set<string>();

async function storeGameIcon(name: string, applicationId: string): Promise<void> {
  // Discord documents no lookup of another application, only app-icons/<id>/<icon>.png on its
  // CDN; this public endpoint (what the client uses for activities) returns the icon hash.
  let icon: string | null | undefined;
  try {
    ({ icon } = (await client.rest.get(`/applications/${applicationId}/rpc`)) as { icon: string | null });
  } catch (err) {
    log("warn", "game_icon_failed", { game: name, error: err });
  }
  // Without `icon` the upsert leaves an icon stored earlier alone.
  const row = icon === undefined ? { name, application_id: applicationId } : { name, application_id: applicationId, icon };
  const { error } = await db.from("games").upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) log("warn", "game_icon_failed", { game: name, error: error.message });
}

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
  const { timezone } = settingsFor(guild);
  const monday = weekStart(new Date(), timezone);
  if (interaction.commandName === "leaderboard") {
    const period: Period = interaction.options.getString("period") === "all" ? "all" : "week";
    const rows = await leaderboard(guild, period === "week" ? monday : null, 10);
    return { embeds: [leaderboardEmbed(period, rows, monday, config.siteUrl, timezone)] };
  }
  if (interaction.commandName === "me") {
    const userId = interaction.user.id;
    const [counts, received, member, week, allTime] = await Promise.all([
      db.from("message_counts").select("day, count").eq("guild_id", guild).eq("user_id", userId),
      db.from("reactions_received").select("day, count").eq("guild_id", guild).eq("user_id", userId),
      db.from("members").select("hidden").eq("guild_id", guild).eq("user_id", userId).maybeSingle(),
      leaderboard(guild, monday, RANK_TOP),
      leaderboard(guild, null, RANK_TOP),
    ]);
    for (const r of [counts, received, member]) if (r.error) throw new Error(`/me: ${r.error.message}`);
    // shortcut: days are stored as UTC days, so the local week is off by the zone's offset.
    const weekCount = sumSince(counts.data ?? [], monday);
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
  return { embeds: [channelEmbed(target.name, data, config.siteUrl, timezone)] };
}

// The committed placeholder catalogue (#148), one level above both src/ and dist/.
const catalogue = JSON.parse(readFileSync(new URL("../riftbound-catalogue.json", import.meta.url), "utf8")) as Catalogue;

/** /card: one card from the catalogue, for everyone in the channel. */
async function cardCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const typed = interaction.options.getString("name", true);
  const found = lookupCard(catalogue.cards, typed);
  try {
    if (found && "card" in found) {
      const printings = catalogue.printings.filter((p) => p.card_id === found.card.id);
      await interaction.reply({ embeds: [cardEmbed(found.card, printings, config.siteUrl)] });
    } else {
      await interaction.reply({ content: cardMiss(typed, found?.ambiguous ?? null), flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    log("error", "command_failed", { command: CARD_COMMAND.name, error: err });
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete() && interaction.commandName === CARD_COMMAND.name) {
    await tracked(
      "command",
      interaction
        .respond(cardChoices(catalogue.cards, interaction.options.getFocused()))
        .catch((err: unknown) => log("error", "autocomplete_failed", { command: CARD_COMMAND.name, error: err })),
    );
    return;
  }
  const autocompleted = [STORE_COMMAND.name, EVENT_COMMAND.name] as string[];
  if (interaction.isAutocomplete() && interaction.inCachedGuild() && autocompleted.includes(interaction.commandName)) {
    const focused = interaction.options.getFocused(true);
    const choices =
      focused.name === "event"
        ? eventsGoing(interaction.guildId, interaction.user.id).then((events) =>
            eventChoices(events, focused.value, settingsFor(interaction.guildId).timezone),
          )
        : guildStores(interaction.guildId).then((stores) => storeChoices(stores, focused.value));
    await tracked(
      "command",
      choices
        .then((c) => interaction.respond(c))
        .catch((err: unknown) => log("error", "autocomplete_failed", { command: interaction.commandName, error: err })),
    );
    return;
  }
  if (interaction.isButton() && interaction.inCachedGuild()) {
    const eventId = goingEventId(interaction.customId);
    if (eventId !== null) await tracked("command", goingButton(interaction, eventId));
    return;
  }
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
  if (interaction.commandName === FORGET_COMMAND.name) {
    await tracked("command", forgetCommand(interaction));
    return;
  }
  if (interaction.commandName === PROFILE_COMMAND.name) {
    await tracked("command", profileCommand(interaction));
    return;
  }
  if (interaction.commandName === LOL_COMMAND.name) {
    await tracked("command", lolCommand(interaction));
    return;
  }
  if (interaction.commandName === SETUP_COMMAND.name) {
    await tracked("command", setupCommand(interaction));
    return;
  }
  if (interaction.commandName === RECAP_COMMAND.name) {
    await tracked("command", recapCommand(interaction));
    return;
  }
  if (interaction.commandName === STORE_COMMAND.name) {
    await tracked("command", storeCommand(interaction));
    return;
  }
  if (interaction.commandName === EVENT_COMMAND.name) {
    await tracked("command", eventCommand(interaction));
    return;
  }
  if (interaction.commandName === CARD_COMMAND.name) {
    await tracked("command", cardCommand(interaction));
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
          if (!flag) {
            const remembered = await db.rpc("remember_user", { member: row.user_id });
            if (remembered.error) throw new Error(`remember_user: ${remembered.error.message}`);
            // Back on the website now, rather than at the next restart's membership sync.
            for (const guild of client.guilds.cache.values()) {
              if (guild.members.cache.has(row.user_id)) {
                await membership(guild.id, () => addMembers(guild.id, [row.user_id]));
              }
            }
          }
          // Upsert so a member who has never posted still gets a row to carry the flag.
          const { error } = await db.from("members").upsert(
            { ...row, guild_id: interaction.guildId, hidden: flag, updated_at: new Date().toISOString() },
            { onConflict: "guild_id,user_id" },
          );
          if (error) throw new Error(`members upsert: ${error.message}`);
          // Game time restarts now: nothing buffered across a hide or show may reach the database,
          // which drops only what arrives while the member is hidden.
          games.drop(row.user_id);
          gameBuffer.drop(row.user_id);
          gameBuffer.add(games.update(row.user_id, gameKeys(interaction.member.presence?.activities ?? []), new Date()));
        },
      },
      memberRow(interaction.user, interaction.member),
      hidden,
    );
    await interaction.editReply(reply);
    if (hidden) void tracked("rank_roles", clearRankRoles(interaction.user.id, [interaction.guild]));
  } catch (err) {
    log("error", "command_failed", { command: interaction.commandName, error: err });
  }
});

const FORGET_CONFIRM_MS = 60_000;

/** Asks for confirmation with buttons only the caller sees, then forgets them everywhere. */
async function forgetCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(FORGET_CONFIRM_ID).setLabel("Delete my data").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(FORGET_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const response = await interaction.reply({
    content: FORGET_PROMPT,
    components: [buttons],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  const click = await response.resource?.message
    ?.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: FORGET_CONFIRM_MS })
    // Timed out: same as Cancel.
    .catch(() => null);
  const confirmed = click?.customId === FORGET_CONFIRM_ID;
  if (click) await click.deferUpdate();
  const reply = await forgetMe(
    {
      async forget(userId) {
        const { error } = await db.rpc("forget_user", { member: userId });
        if (error) throw new Error(`forget_user: ${error.message}`);
      },
    },
    interaction.user.id,
    confirmed,
  );
  if (confirmed) log("info", "user_forgotten", {});
  await interaction.editReply({ content: reply, components: [] });
}

/** /profile visibility: who can see the caller's /u/[userId] page. */
async function profileCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = await setProfileVisibility(
    {
      async setVisibility(userId, visibility) {
        const { data, error } = await db
          .from("profiles")
          .upsert({ user_id: userId, visibility, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
          .select("user_id");
        if (error) throw new Error(`profiles upsert: ${error.message}`);
        // skip_forgotten() drops a forgotten user's row without an error.
        return data.length > 0;
      },
    },
    interaction.user.id,
    interaction.options.getString("level", true),
    config.siteUrl,
  );
  await interaction.editReply(reply);
}

// Interaction tokens last 15 minutes; this leaves time for the last edit.
const LOL_VERIFY_MS = 14 * 60_000;
const LOL_VERIFY_ID = "lol:verify";

function riotLookup(api: RiotApi): RiotLookup {
  return {
    account: (regional, gameName, tagLine) =>
      api.get(regional, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),
    icon: async (platform: Platform, puuid) =>
      (await api.get<{ profileIconId: number }>(platform, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`))
        ?.profileIconId ?? null,
  };
}

/** The icon's picture from Data Dragon, Riot's public CDN; null if its version list is down. */
async function iconUrl(icon: number): Promise<string | null> {
  try {
    const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", { signal: AbortSignal.timeout(5_000) });
    const [version] = (await res.json()) as string[];
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${icon}.png`;
  } catch {
    return null;
  }
}

/** /lol link proves ownership with a profile icon the caller sets, then stores the PUUID; /lol unlink deletes it. */
async function lolCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!riot) {
    await interaction.editReply("League linking is not set up on this bot.");
    return;
  }
  const userId = interaction.user.id;
  try {
    if (interaction.options.getSubcommand() === "unlink") {
      const { data, error } = await db.from("game_accounts").delete().eq("user_id", userId).eq("game", GAME).select("user_id");
      if (error) throw new Error(`game_accounts delete: ${error.message}`);
      await interaction.editReply(data.length ? "Unlinked: your League account is deleted." : "You have no League account linked.");
      if (data.length) void tracked("rank_roles", clearRankRoles(userId, client.guilds.cache.values()));
      return;
    }
    const lookup = riotLookup(riot);
    const challenge = await startLink(lookup, interaction.options.getString("riot-id", true), interaction.options.getString("region", true));
    if (typeof challenge === "string") {
      await interaction.editReply(challenge);
      return;
    }
    const url = await iconUrl(challenge.icon);
    const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(LOL_VERIFY_ID).setLabel("Verify").setStyle(ButtonStyle.Primary),
    );
    const message = await interaction.editReply({
      content: challengeText(challenge),
      embeds: url ? [{ image: { url } }] : [],
      components: [button],
    });
    const deadline = Date.now() + LOL_VERIFY_MS;
    for (;;) {
      const click = await message
        .awaitMessageComponent({ filter: (i) => i.user.id === userId, time: Math.max(0, deadline - Date.now()) })
        .catch(() => null);
      if (!click) {
        await interaction.editReply({ content: "Timed out, nothing was linked. Run /lol link again.", embeds: [], components: [] });
        return;
      }
      await click.deferUpdate();
      const { done, reply } = await verifyLink(
        lookup,
        {
          async link(id, c) {
            const { data, error } = await db
              .from("game_accounts")
              .upsert(
                { user_id: id, game: GAME, external_id: c.puuid, region: c.platform, verified_at: new Date().toISOString() },
                { onConflict: "user_id,game" },
              )
              .select("user_id");
            if (error) throw new Error(`game_accounts upsert: ${error.message}`);
            // skip_forgotten() drops a forgotten user's row without an error.
            return data.length > 0;
          },
        },
        userId,
        challenge,
      );
      await interaction.editReply(done ? { content: reply, embeds: [], components: [] } : { content: reply });
      if (done) {
        log("info", "lol_linked", {});
        void tracked("lol_ranks", refreshRank(userId, challenge.puuid, challenge.platform));
        void tracked("lol_matches", refreshMatches(userId, challenge.puuid, challenge.platform));
        return;
      }
    }
  } catch (err) {
    log("error", "command_failed", { command: LOL_COMMAND.name, error: err });
    await interaction
      .editReply({ content: "Something went wrong, nothing was changed. Please try again later.", embeds: [], components: [] })
      .catch(() => {});
  }
}

/** /setup: only members with Manage Server see it (default_member_permissions). */
async function setupCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  // Deferred because Discord drops replies sent more than 3 s in, and the write may be slow.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const channel = interaction.options.getChannel("channel");
  const me = interaction.guild.members.me;
  const subcommand = interaction.options.getSubcommand();
  const state = interaction.options.getString("state");
  const change = setupChange({
    subcommand,
    channelId: channel?.id ?? null,
    canSend:
      !!channel &&
      !!me &&
      !!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
    timezone: interaction.options.getString("timezone"),
    include: interaction.options.getBoolean("include"),
    state,
    rankRolesProblem: subcommand === "rank-roles" && state === "on" ? rankRolesCheck(interaction.guild) : null,
  });
  const { reply, settings: next } = await applySetup(
    {
      async save(columns) {
        const { error } = await db
          .from("guild_settings")
          .upsert({ guild_id: guildId, ...columns, updated_at: new Date().toISOString() }, { onConflict: "guild_id" });
        if (error) throw new Error(`guild_settings upsert: ${error.message}`);
      },
    },
    settingsFor(guildId),
    change,
  );
  settings.set(guildId, next);
  if (change && typeof change === "object") log("info", "setup_changed", { guild: guildId, ...change });
  await interaction.editReply(reply);
  if (change && typeof change === "object" && change.rank_roles) void tracked("rank_roles", syncRankRoles(interaction.guild));
}

async function guildStores(guildId: string): Promise<Store[]> {
  const { data, error } = await db
    .from("stores")
    .select("id, game, name, city, url, added_by")
    .eq("guild_id", guildId)
    .order("name");
  if (error) throw new Error(`stores select: ${error.message}`);
  return data;
}

/** /store: add, list and remove the server's stores, and mark your regulars. */
async function storeCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const sub = interaction.options.getSubcommand();
  // Only the list is for everyone; the rest answers just the caller.
  await interaction.deferReply(sub === "list" ? {} : { flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  let reply: string;
  try {
    if (sub === "list") {
      reply = storeList(await guildStores(guildId), config.siteUrl, guildId);
    } else if (sub === "add") {
      const row = newStore({
        name: interaction.options.getString("name", true),
        city: interaction.options.getString("city", true),
        link: interaction.options.getString("link"),
        game: interaction.options.getString("game"),
      });
      if (typeof row === "string") {
        reply = row;
      } else {
        const { error } = await db.from("stores").insert({ ...row, guild_id: guildId, added_by: userId });
        if (error?.code === "23505") reply = `${storeLabel(row)} is already on the list.`;
        else if (error) throw new Error(`stores insert: ${error.message}`);
        else reply = `Added ${storeLabel(row)}. Mark it as yours with /store mine.`;
      }
    } else {
      // Autocomplete only suggests; a typed id may belong to another server, hence the guild filter.
      const store = (await guildStores(guildId)).find((s) => s.id === interaction.options.getInteger("store", true));
      if (!store) {
        reply = "That store is not on this server's list. Pick one from the suggestions.";
      } else if (sub === "remove") {
        if (!canRemove(store, userId, interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild))) {
          reply = "Only the member who added it, or someone with Manage Server, can remove it.";
        } else {
          const { error } = await db.from("stores").delete().eq("guild_id", guildId).eq("id", store.id);
          if (error) throw new Error(`stores delete: ${error.message}`);
          reply = `Removed ${storeLabel(store)}.`;
        }
      } else {
        // A toggle, so the same command undoes it.
        const { data, error } = await db
          .from("store_regulars")
          .delete()
          .eq("store_id", store.id)
          .eq("user_id", userId)
          .select("store_id");
        if (error) throw new Error(`store_regulars delete: ${error.message}`);
        if (data.length > 0) {
          reply = `${storeLabel(store)} is no longer one of your regulars.`;
        } else {
          const added = await db.from("store_regulars").insert({ guild_id: guildId, store_id: store.id, user_id: userId });
          if (added.error) throw new Error(`store_regulars insert: ${added.error.message}`);
          reply = `${storeLabel(store)} is now one of your regulars. Use /store mine again to undo.`;
        }
      }
    }
  } catch (err) {
    log("error", "command_failed", { command: STORE_COMMAND.name, error: err });
    reply = "Something went wrong, nothing was changed. Please try again later.";
  }
  // Store names are typed by members: no @everyone or role pings from them.
  await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
}

/** The server's upcoming events, with goers' names; hidden members are left out by upcoming_events() itself. */
async function upcomingEvents(guildId: string, until: Date | null = null): Promise<UpcomingEvent[]> {
  const { data, error } = await db.rpc("upcoming_events", { guild: guildId, until: until?.toISOString() ?? null });
  if (error) throw new Error(`upcoming_events: ${error.message}`);
  return data as UpcomingEvent[];
}

/** The upcoming events a member is going to, for /event not-going; one member's are few, so all of them. */
async function eventsGoing(guildId: string, userId: string): Promise<UpcomingEvent[]> {
  const { data, error } = await db
    .from("event_attendees")
    .select("events!inner(id, name, starts_at, url, stores(name, city))")
    .eq("guild_id", guildId)
    .eq("user_id", userId)
    .gte("events.starts_at", new Date().toISOString());
  if (error) throw new Error(`event_attendees select: ${error.message}`);
  return data
    .map(({ events }) => {
      const e = events as unknown as Omit<UpcomingEvent, "store_name" | "store_city" | "going"> & {
        stores: { name: string; city: string } | null;
      };
      return { ...e, store_name: e.stores?.name ?? null, store_city: e.stores?.city ?? null, going: [] };
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Marks members as going; their members row is what gives the site and the report a name to show.
 * `fromDiscord` is for Interested clicks: it never overrides what a member said with the bot.
 */
async function markGoing(guild: Guild, eventId: number, userIds: string[], fromDiscord = false): Promise<void> {
  // The member cache is complete (see UserUpdate): a miss is someone no longer in the server.
  const members = userIds.flatMap((id) => {
    const member = guild.members.cache.get(id);
    return member && !member.user.bot ? [member] : [];
  });
  if (!members.length) return;
  for (const m of members) servers.get(guild.id)?.activity.setMember(memberRow(m.user, m));
  const { error } = await db
    .from("event_attendees")
    .upsert(
      members.map((m) => ({ guild_id: guild.id, event_id: eventId, user_id: m.id, from_discord: fromDiscord })),
      { onConflict: "event_id,user_id", ignoreDuplicates: fromDiscord },
    );
  if (error) throw new Error(`event_attendees upsert: ${error.message}`);
}

interface EventRow {
  id: number;
  starts_at: string;
  url: string | null;
  stores: Pick<Store, "game" | "name" | "city"> | null;
}

const EVENT_COLUMNS = "id, starts_at, url, stores(game, name, city)";

/** /event going and not-going. Answers the caller only; a going is announced with a Going button for everyone. */
async function eventCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  // Deferred because Discord drops replies sent more than 3 s in, and the writes may be slow.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const { timezone } = settingsFor(guildId);
  let reply: string;
  let announce: EventRow | null = null;
  try {
    if (interaction.options.getSubcommand() === "not-going") {
      // Filtered on the guild too: a typed id may belong to another server.
      const { data, error } = await db
        .from("event_attendees")
        .delete()
        .eq("guild_id", guildId)
        .eq("event_id", interaction.options.getInteger("event", true))
        .eq("user_id", userId)
        .select("event_id");
      if (error) throw new Error(`event_attendees delete: ${error.message}`);
      reply = data.length
        ? "You are no longer going. If you clicked Interested on the Discord event, untick that too."
        : "You were not going to that event.";
    } else {
      const event = await findOrAddEvent(interaction, guildId, timezone);
      if (typeof event === "string") {
        reply = event;
      } else {
        await markGoing(interaction.guild, event.id, [userId]);
        reply = "You are going. Undo it with /event not-going.";
        announce = event;
      }
    }
  } catch (err) {
    log("error", "command_failed", { command: EVENT_COMMAND.name, error: err });
    reply = "Something went wrong, nothing was changed. Please try again later.";
  }
  await interaction.editReply(reply);
  if (!announce) return;
  const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(goingId(announce.id)).setLabel("Going").setStyle(ButtonStyle.Primary),
  );
  // Store names are typed by members: no @everyone or role pings from them.
  await interaction.followUp({
    content: goingText(announce.stores, announce.starts_at, timezone, announce.url),
    components: [button],
    allowedMentions: { parse: [] },
  });
}

/** The event /event going names: by its link, else by store and time, added if not known yet. Or why not. */
async function findOrAddEvent(
  interaction: ChatInputCommandInteraction<"cached">,
  guildId: string,
  timeZone: string,
): Promise<EventRow | string> {
  const link = interaction.options.getString("link");
  const storeId = interaction.options.getInteger("store");
  const when = interaction.options.getString("when");
  const url = link ? httpsUrl(link) : null;
  if (link && !url) return LINK_ERROR;
  if (url) {
    const { data, error } = await db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("guild_id", guildId)
      .eq("url", url)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`events select: ${error.message}`);
    if (data) return data as unknown as EventRow;
  }
  if (storeId === null || !when) {
    return url
      ? "That event is not known yet. Add its store and when as well, and it gets added."
      : "Give the event's link, or its store and when.";
  }
  const store = (await guildStores(guildId)).find((s) => s.id === storeId);
  if (!store) return "That store is not on this server's list. Pick one from the suggestions, or add it with /store add.";
  const at = parseWhen(when, timeZone, new Date());
  if (typeof at === "string") return at;
  const find = async () => {
    const { data, error } = await db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("guild_id", guildId)
      .eq("store_id", store.id)
      .eq("starts_at", at.toISOString())
      .order("id")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`events select: ${error.message}`);
    return data as unknown as EventRow | null;
  };
  const known = await find();
  if (known) return known;
  const { data, error } = await db
    .from("events")
    .insert({ guild_id: guildId, store_id: store.id, starts_at: at.toISOString(), url })
    .select(EVENT_COLUMNS)
    .single();
  // Someone added the same store and time a moment ago.
  if (error?.code === "23505") return (await find()) ?? "Something went wrong, nothing was changed. Please try again.";
  if (error) throw new Error(`events insert: ${error.message}`);
  log("info", "event_added", { guild: guildId, event: data.id });
  return data as unknown as EventRow;
}

/** The Going button under an /event going message. */
async function goingButton(interaction: ButtonInteraction<"cached">, eventId: number): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { timezone } = settingsFor(interaction.guildId);
  let reply: string;
  try {
    const { data, error } = await db
      .from("events")
      .select("id, name, starts_at, stores(name, city)")
      .eq("guild_id", interaction.guildId)
      .eq("id", eventId)
      .gte("starts_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(`events select: ${error.message}`);
    if (!data) {
      reply = "That event is over or no longer listed.";
    } else {
      await markGoing(interaction.guild, data.id, [interaction.user.id]);
      const store = data.stores as unknown as { name: string; city: string } | null;
      const label = eventLabel({ ...data, store_name: store?.name ?? null, store_city: store?.city ?? null }, timezone);
      reply = `You are going: ${label}. Undo it with /event not-going.`;
    }
  } catch (err) {
    log("error", "command_failed", { command: "event-going-button", error: err });
    reply = "Something went wrong, nothing was changed. Please try again later.";
  }
  await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
}

/** Saves a Discord event of the server, with the store its location names; returns its row id, or null once canceled. */
async function saveScheduledEvent(event: GuildScheduledEvent): Promise<number | null> {
  if (event.isCanceled()) {
    await deleteScheduledEvent(event.id);
    return null;
  }
  const stores = await guildStores(event.guildId);
  const { data, error } = await db
    .from("events")
    .upsert(
      {
        guild_id: event.guildId,
        discord_event_id: event.id,
        name: event.name,
        starts_at: new Date(event.scheduledStartTimestamp ?? Date.now()).toISOString(),
        url: event.url,
        // Only the location's text is read, to pick a store; it is not stored.
        store_id: matchStore(stores, event.entityMetadata?.location ?? null)?.id ?? null,
      },
      { onConflict: "discord_event_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`events upsert: ${error.message}`);
  return data.id as number;
}

async function deleteScheduledEvent(discordEventId: string): Promise<void> {
  const { error } = await db.from("events").delete().eq("discord_event_id", discordEventId);
  if (error) throw new Error(`events delete: ${error.message}`);
}

/** All of a server's Discord events and their Interested members, and drops the ones deleted while the bot was offline. */
async function syncScheduledEvents(guild: Guild): Promise<void> {
  const events = await guild.scheduledEvents.fetch();
  for (const event of events.values()) {
    const id = await saveScheduledEvent(event);
    if (id === null) continue;
    const interested = await allSubscriberIds(async (after) => {
      const page = await event.fetchSubscribers({ limit: SUBSCRIBER_PAGE, after });
      return [...page.keys()];
    });
    await markGoing(guild, id, interested, true);
    // Unticks while the bot was offline. shortcut: an Interested click landing between the fetch
    // above and this delete is lost until the next start; lock per event if that ever shows up.
    const recorded = await db.from("event_attendees").select("user_id").eq("event_id", id).eq("from_discord", true);
    if (recorded.error) throw new Error(`event_attendees select: ${recorded.error.message}`);
    const stale = unticked(recorded.data.map((r) => r.user_id as string), interested);
    if (stale.length) {
      const removed = await db.from("event_attendees").delete().eq("event_id", id).eq("from_discord", true).in("user_id", stale);
      if (removed.error) throw new Error(`event_attendees delete: ${removed.error.message}`);
    }
  }
  let gone = db
    .from("events")
    .delete()
    .eq("guild_id", guild.id)
    .not("discord_event_id", "is", null)
    .gte("starts_at", new Date().toISOString());
  // Snowflakes are digits only, so they are safe in the filter as they are.
  if (events.size) gone = gone.not("discord_event_id", "in", `(${[...events.keys()].join(",")})`);
  const { error } = await gone;
  if (error) throw new Error(`events delete: ${error.message}`);
  log("info", "scheduled_events_synced", { guild: guild.id, events: events.size });
}

client.on(Events.GuildScheduledEventCreate, (event) => void tracked("scheduled_event", saveScheduledEvent(event)));
client.on(Events.GuildScheduledEventUpdate, (_old, event) => void tracked("scheduled_event", saveScheduledEvent(event)));
client.on(Events.GuildScheduledEventDelete, (event) => void tracked("scheduled_event", deleteScheduledEvent(event.id)));

client.on(Events.GuildScheduledEventUserAdd, (event, user) =>
  void tracked(
    "scheduled_event_user",
    (async () => {
      const full = event.partial ? await event.fetch() : event;
      const id = await saveScheduledEvent(full);
      if (id !== null && full.guild) await markGoing(full.guild, id, [user.id], true);
    })(),
  ),
);

client.on(Events.GuildScheduledEventUserRemove, (event, user) =>
  void tracked(
    "scheduled_event_user",
    (async () => {
      const { data, error } = await db.from("events").select("id").eq("discord_event_id", event.id).maybeSingle();
      if (error) throw new Error(`events select: ${error.message}`);
      if (!data) return;
      // A going said with the bot stays: undoing that is /event not-going.
      const removed = await db
        .from("event_attendees")
        .delete()
        .eq("event_id", data.id)
        .eq("user_id", user.id)
        .eq("from_discord", true);
      if (removed.error) throw new Error(`event_attendees delete: ${removed.error.message}`);
    })(),
  ),
);

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
          since: dayStart(new Date(), settingsFor(guild.id).timezone).toISOString(),
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

/** Riot's queue may have held a refresh for minutes: write only if this is still the linked account. */
async function stillLinked(userId: string, puuid: string, platform: string): Promise<boolean> {
  const linked = await db
    .from("game_accounts")
    .select("user_id")
    .eq("user_id", userId)
    .eq("game", GAME)
    .eq("external_id", puuid)
    .eq("region", platform);
  if (linked.error) throw new Error(`game_accounts: ${linked.error.message}`);
  return linked.data.length > 0;
}

// One rank refresh at a time per user, so an old account's refresh cannot finish after a relink's.
const rankRefreshes = keyedQueue();

/** Stores one account's official ranks; Riot's entries replace the stored ones. */
function refreshRank(userId: string, puuid: string, platform: string): Promise<void> {
  return rankRefreshes(userId, () => refreshRankNow(userId, puuid, platform));
}

async function refreshRankNow(userId: string, puuid: string, platform: string): Promise<void> {
  if (!riot) return;
  const entries = (await riot.get<LeagueEntry[]>(platform, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`)) ?? [];
  if (!(await stillLinked(userId, puuid, platform))) return;
  const rows = rankRows(userId, entries).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  if (rows.length) {
    // Fails on the foreign key when the account was unlinked meanwhile, which is what we want.
    const { error } = await db.from("lol_ranks").upsert(rows, { onConflict: "user_id,queue" });
    if (error) throw new Error(`lol_ranks upsert: ${error.message}`);
  }
  // Queues no longer ranked in (a new season, or decayed out) go.
  let stale = db.from("lol_ranks").delete().eq("user_id", userId);
  if (rows.length) stale = stale.not("queue", "in", `(${rows.map((r) => r.queue).join(",")})`);
  const { error } = await stale;
  if (error) throw new Error(`lol_ranks delete: ${error.message}`);
}

let refreshingRanks = false;

/** Every 3 hours: every linked account's ranks, then the rank roles, which need no Riot key. */
async function refreshRanks(): Promise<void> {
  if (riot && !refreshingRanks) {
    refreshingRanks = true;
    try {
      // shortcut: the development key's 100 requests per 2 minutes take 1000 accounts 20 minutes; get a production key first.
      const accounts = await readAll(async (from, to) => {
        const { data, error } = await db
          .from("game_accounts")
          .select("user_id, external_id, region")
          .eq("game", GAME)
          .order("user_id")
          .range(from, to);
        if (error) throw new Error(`game_accounts: ${error.message}`);
        return data;
      });
      let failed = 0;
      for (const a of accounts) {
        try {
          await refreshRank(a.user_id, a.external_id, a.region);
        } catch (err) {
          failed++;
          log("warn", "lol_rank_failed", { error: err });
        }
      }
      log("info", "lol_ranks_refreshed", { accounts: accounts.length, failed });
    } catch (err) {
      log("error", "lol_ranks_failed", { error: err });
    } finally {
      refreshingRanks = false;
    }
  }
  for (const guild of client.guilds.cache.values()) await tracked("rank_roles", syncRankRoles(guild));
}

// One games refresh at a time per user, as for ranks.
const matchRefreshes = keyedQueue();

/** Stores the account's new ranked and normal games since KEEP_MS ago, and drops older ones. */
function refreshMatches(userId: string, puuid: string, platform: string): Promise<void> {
  return matchRefreshes(userId, () => refreshMatchesNow(userId, puuid, platform));
}

async function refreshMatchesNow(userId: string, puuid: string, platform: string): Promise<void> {
  if (!riot) return;
  const region = matchRegion(platform);
  const since = Date.now() - KEEP_MS;
  const stored = await db.from("lol_matches").select("match_id").eq("user_id", userId).eq("puuid", puuid);
  if (stored.error) throw new Error(`lol_matches: ${stored.error.message}`);
  const known = new Set(stored.data.map((m) => m.match_id));
  const ids = new Set<string>();
  for (const type of MATCH_TYPES) {
    const all = await allIds((start) => riot.get<string[]>(region, matchIdsPath(puuid, type, since, start)));
    for (const id of all) if (!known.has(id)) ids.add(id);
  }
  const rows: MatchRow[] = [];
  for (const id of ids) {
    const match = await riot.get<Match>(region, `/lol/match/v5/matches/${encodeURIComponent(id)}`);
    const row = match && matchRow(userId, puuid, match);
    if (row) rows.push(row);
  }
  if (!(await stillLinked(userId, puuid, platform))) return;
  if (rows.length) {
    // Fails on the foreign key when the account was unlinked meanwhile, which is what we want.
    const { error } = await db.from("lol_matches").upsert(rows, { onConflict: "user_id,match_id" });
    if (error) throw new Error(`lol_matches upsert: ${error.message}`);
  }
  const { error } = await db.from("lol_matches").delete().eq("user_id", userId).lt("played_at", new Date(since).toISOString());
  if (error) throw new Error(`lol_matches delete: ${error.message}`);
}

let refreshingMatches = false;

/**
 * Every 6 hours: every linked account's new games. Small steps all week through the Riot
 * queue, rather than every member's week at once when the report is due.
 */
async function refreshAllMatches(): Promise<void> {
  if (!riot || refreshingMatches) return;
  refreshingMatches = true;
  try {
    const accounts = await readAll(async (from, to) => {
      const { data, error } = await db
        .from("game_accounts")
        .select("user_id, external_id, region")
        .eq("game", GAME)
        .order("user_id")
        .range(from, to);
      if (error) throw new Error(`game_accounts: ${error.message}`);
      return data;
    });
    let failed = 0;
    for (const a of accounts) {
      try {
        await refreshMatches(a.user_id, a.external_id, a.region);
      } catch (err) {
        failed++;
        log("warn", "lol_matches_account_failed", { error: err });
      }
    }
    log("info", "lol_matches_refreshed", { accounts: accounts.length, failed });
  } catch (err) {
    log("error", "lol_matches_failed", { error: err });
  } finally {
    refreshingMatches = false;
  }
}

/** The server's existing rank roles, by tier: the roles named after a tier. */
function rankRolesOf(guild: Guild) {
  const names = new Map(TIERS.map((t) => [tierName(t), t]));
  return [...guild.roles.cache.values()].filter((r) => names.has(r.name)).map((r) => ({ role: r, tier: names.get(r.name)! }));
}

/** Takes a user's rank roles away in these servers now (/lol unlink, /hide-me), not at the next refresh. */
async function clearRankRoles(userId: string, guilds: Iterable<Guild>): Promise<void> {
  for (const guild of guilds) {
    const member = guild.members.cache.get(userId);
    if (!member || !settingsFor(guild.id).rank_roles) continue;
    const { remove } = roleChanges(new Set(member.roles.cache.keys()), null, rankRolesOf(guild).map(({ role }) => role.id));
    if (remove.length) await member.roles.remove(remove, "ni han bao rank roles");
  }
}

/** Why the bot cannot keep rank roles in this server, or null. */
function rankRolesCheck(guild: Guild): string | null {
  const me = guild.members.me;
  return rankRolesProblem(
    !!me?.permissions.has(PermissionFlagsBits.ManageRoles),
    me?.roles.highest.position ?? 0,
    rankRolesOf(guild).map(({ role }) => ({
      name: role.name,
      position: role.position,
      managed: role.managed,
      grantsAccess:
        role.permissions.bitfield !== 0n ||
        guild.channels.cache.some((c) => "permissionOverwrites" in c && c.permissionOverwrites.cache.has(role.id)),
    })),
  );
}

/**
 * With /setup rank-roles on: gives each linked member the role of their tier (creating the
 * tier roles it lacks) and takes the other rank roles away. Hidden members get none.
 */
async function syncRankRoles(guild: Guild): Promise<void> {
  if (!settingsFor(guild.id).rank_roles) return;
  // Permissions or role order changed since /setup: skip until fixed, and say why in the log.
  const problem = rankRolesCheck(guild);
  if (problem) {
    log("warn", "rank_roles_skipped", { guild: guild.id, problem });
    return;
  }
  const byTier = new Map(rankRolesOf(guild).map(({ role, tier }) => [tier, role.id]));
  for (const tier of TIERS) {
    if (byTier.has(tier)) continue;
    const role = await guild.roles.create({ name: tierName(tier), permissions: [], reason: "ni han bao rank roles (/setup rank-roles)" });
    byTier.set(tier, role.id);
  }
  // Read in full before any change: a missing row would take a member's role away.
  const [ranks, hidden] = await Promise.all([
    readAll(async (from, to) => {
      const { data, error } = await db.from("lol_ranks").select("user_id, queue, tier").order("user_id").order("queue").range(from, to);
      if (error) throw new Error(`lol_ranks: ${error.message}`);
      return data;
    }),
    readAll(async (from, to) => {
      const { data, error } = await db
        .from("members")
        .select("user_id")
        .eq("guild_id", guild.id)
        .eq("hidden", true)
        .order("user_id")
        .range(from, to);
      if (error) throw new Error(`members: ${error.message}`);
      return data;
    }),
  ]);
  const hiddenIds = new Set(hidden.map((m) => m.user_id));
  const rankIds = [...byTier.values()];
  let failed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const tier = hiddenIds.has(member.id) ? null : roleTier(ranks.filter((r) => r.user_id === member.id));
    const { add, remove } = roleChanges(new Set(member.roles.cache.keys()), tier && byTier.get(tier)!, rankIds);
    // Per member: one Discord refuses (the owner, say) must not stop the rest.
    try {
      if (add.length) await member.roles.add(add, "ni han bao rank roles");
      if (remove.length) await member.roles.remove(remove, "ni han bao rank roles");
    } catch (err) {
      failed++;
      log("warn", "rank_role_failed", { guild: guild.id, member: member.id, error: err });
    }
  }
  if (failed) log("warn", "rank_roles_partial", { guild: guild.id, failed });
}

// Week last seen posted per server, so the database is asked once per week rather than every check.
const reportedWeek = new Map<string, string>();
const reporting = new Set<string>();

function weeklyReports(): void {
  for (const guild of client.guilds.cache.values()) void weeklyReport(guild.id);
}

async function weeklyReport(guild: string): Promise<void> {
  const { report_channel_id: channelId, timezone } = settingsFor(guild);
  const week = dueReportWeek(new Date(), timezone);
  if (!channelId || week === null || week === reportedWeek.get(guild) || reporting.has(guild)) return;
  reporting.add(guild);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable() || channel.isDMBased() || channel.guildId !== guild) {
      throw new Error("the report channel is not a channel of this server the bot can post in");
    }
    const recorded = await db
      .from("report_cards")
      .select("week")
      .eq("guild_id", guild)
      .eq("week", week)
      .maybeSingle();
    if (recorded.error) throw new Error(`report_cards select: ${recorded.error.message}`);
    if (recorded.data) {
      reportedWeek.set(guild, week);
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
      reportSlot(new Date(), timezone).getTime() - 60_000,
      (m) => m.author.id === client.user?.id && isReportFor(m.embeds, week),
    );
    if (!posted) {
      const { data, error } = await db.rpc("report_card", {
        since: week,
        until: addDays(week, 7),
        guild,
        tz: timezone,
      });
      if (error) throw new Error(`report_card: ${error.message}`);
      const events = await upcomingEvents(guild, new Date(Date.now() + 7 * 24 * 60 * 60_000));
      const league = await db.rpc("lol_week", {
        g: guild,
        since: new Date(fromWallClock(Date.parse(week), timezone)).toISOString(),
        until: new Date(fromWallClock(Date.parse(addDays(week, 7)), timezone)).toISOString(),
      });
      if (league.error) throw new Error(`lol_week: ${league.error.message}`);
      // The nonce makes Discord drop a second send of the same week from a concurrent bot.
      await channel.send({
        embeds: [reportEmbed(week, data as ReportData, config.siteUrl, timezone, events, league.data as LeagueWeek[])],
        nonce: `report-${week}`,
        enforceNonce: true,
      });
    }
    const record = await db
      .from("report_cards")
      .upsert({ guild_id: guild, week }, { onConflict: "guild_id,week", ignoreDuplicates: true });
    if (record.error) throw new Error(`report_cards upsert: ${record.error.message}`);
    reportedWeek.set(guild, week);
    log("info", "report_posted", { guild, week });
  } catch (err) {
    log("error", "report_failed", { guild, week, error: err });
  } finally {
    reporting.delete(guild);
  }
}

const RECAP_FETCH_MS = 30_000;

/** The month's card, drawn by the site with the month's key (made once per server and month). */
async function recapCard(guild: string, month: string) {
  if (!config.siteUrl) throw new Error("SITE_URL is not set: the site draws the recap card");
  const made = await db
    .from("monthly_recaps")
    .upsert({ guild_id: guild, month }, { onConflict: "guild_id,month", ignoreDuplicates: true });
  if (made.error) throw new Error(`monthly_recaps upsert: ${made.error.message}`);
  const { data, error } = await db
    .from("monthly_recaps")
    .select("key")
    .eq("guild_id", guild)
    .eq("month", month)
    .single();
  if (error) throw new Error(`monthly_recaps select: ${error.message}`);
  const urls = recapUrls(config.siteUrl, guild, month, data.key);
  const res = await fetch(urls.image, { signal: AbortSignal.timeout(RECAP_FETCH_MS) });
  if (!res.ok || res.headers.get("content-type") !== "image/png") {
    throw new Error(`recap card: HTTP ${res.status} ${res.headers.get("content-type")}`);
  }
  return recapMessage(month, Buffer.from(await res.arrayBuffer()), urls.page);
}

/** /recap: last month's card, posted in the channel for everyone. */
async function recapCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  // Deferred because Discord drops replies sent more than 3 s in, and drawing the card is slower.
  await interaction.deferReply();
  const month = lastMonth(new Date(), settingsFor(interaction.guildId).timezone);
  try {
    await interaction.editReply(await recapCard(interaction.guildId, month));
  } catch (err) {
    log("error", "command_failed", { command: RECAP_COMMAND.name, error: err });
    await interaction.editReply("Could not make the recap. Please try again later.");
  }
}

// Month last seen posted per server, as reportedWeek does for the weekly report.
const recappedMonth = new Map<string, string>();
const recapping = new Set<string>();

function monthlyRecaps(): void {
  for (const guild of client.guilds.cache.values()) void monthlyRecap(guild.id);
}

/** On the 1st, last month's card in the report channel; posted once, like the weekly report. */
async function monthlyRecap(guild: string): Promise<void> {
  const { report_channel_id: channelId, timezone } = settingsFor(guild);
  const month = dueRecapMonth(new Date(), timezone);
  if (!channelId || month === null || month === recappedMonth.get(guild) || recapping.has(guild)) return;
  recapping.add(guild);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable() || channel.isDMBased() || channel.guildId !== guild) {
      throw new Error("the report channel is not a channel of this server the bot can post in");
    }
    const recorded = await db
      .from("monthly_recaps")
      .select("posted_at")
      .eq("guild_id", guild)
      .eq("month", month)
      .maybeSingle();
    if (recorded.error) throw new Error(`monthly_recaps select: ${recorded.error.message}`);
    if (recorded.data?.posted_at) {
      recappedMonth.set(guild, month);
      return;
    }
    // As in weeklyReport: the channel decides whether it went out, so a lost response does not post twice.
    const posted = await postedSince(
      async (before) => [
        ...(await channel.messages.fetch(before ? { limit: PAGE_SIZE, before } : { limit: PAGE_SIZE })).values(),
      ],
      recapSlot(new Date(), timezone).getTime() - 60_000,
      (m) => m.author.id === client.user?.id && isRecapFor(m.embeds, month),
    );
    if (!posted) {
      await channel.send({ ...(await recapCard(guild, month)), nonce: recapNonce(guild, month), enforceNonce: true });
    }
    const record = await db
      .from("monthly_recaps")
      .upsert({ guild_id: guild, month, posted_at: new Date().toISOString() }, { onConflict: "guild_id,month" });
    if (record.error) throw new Error(`monthly_recaps upsert: ${record.error.message}`);
    recappedMonth.set(guild, month);
    log("info", "recap_posted", { guild, month });
  } catch (err) {
    log("error", "recap_failed", { guild, month, error: err });
  } finally {
    recapping.delete(guild);
  }
}

// One server at a time, so a single backfill shares Discord's rate limits with live work.
let backfills = Promise.resolve();

/** Counts a server's history behind the others in the queue; live counting goes on meanwhile. */
function queueBackfill(guildId: string): void {
  backfills = backfills.then(() => tracked("backfill", backfillServer(guildId)));
}

async function backfillServer(guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  // Left the server while it waited in the queue.
  if (!guild || stopping) return;
  const { data, error } = await db.from("backfill_state").select("done_at").eq("guild_id", guildId).maybeSingle();
  if (error) throw new Error(`backfill_state select: ${error.message}`);
  if (data?.done_at) return;
  // A failed channel leaves the server not done; the next start resumes it.
  await backfillGuild(db, guild, {
    log,
    stopped: () => stopping || !client.guilds.cache.has(guildId),
    timeZone: settingsFor(guildId).timezone,
  });
}

/**
 * Starts counting in one server: on ready for each server the bot is in, and on GuildCreate
 * for one it joins, so a new server needs no restart. Then queues its history backfill.
 */
async function startServer(guild: Guild): Promise<void> {
  // Guild commands, not global ones: they apply instantly.
  try {
    await guild.commands.set([
      ...VISIBILITY_COMMANDS,
      FORGET_COMMAND,
      PROFILE_COMMAND,
      LOL_COMMAND,
      ...STATS_COMMANDS,
      SETUP_COMMAND,
      RECAP_COMMAND,
      STORE_COMMAND,
      EVENT_COMMAND,
      CARD_COMMAND,
    ]);
  } catch (err) {
    log("error", "command_registration_failed", { guild: guild.id, error: err });
  }
  if (!servers.has(guild.id)) {
    // Not caught: a server without its boundary goes uncounted, so the rejection is fatal and
    // Docker restarts the bot to try again.
    const liveFrom = await loadBeforeId(db, guild.id);
    if (!servers.has(guild.id)) servers.set(guild.id, newServer(guild.id, liveFrom));
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
    // Whoever was already playing is counted from now on, like voice.
    for (const p of guild.presences.cache.values()) {
      if (!p.user?.bot) gameBuffer.add(games.update(p.userId, gameKeys(p.activities), new Date()));
    }
  } catch (err) {
    log("error", "member_sync_failed", { guild: guild.id, error: err });
  }
  // After the member sync: goers' names and the backfill's authors come from the member cache.
  void tracked("scheduled_events_sync", syncScheduledEvents(guild));
  queueBackfill(guild.id);
}

/** The committed placeholder catalogue (#148), upserted on every start: only the bot writes it. */
async function loadCatalogue(): Promise<void> {
  const { cards, printings } = catalogue;
  // shortcut: a card dropped from the file stays in the table; delete it by hand until the real API (#96) replaces them all.
  const updated_at = new Date().toISOString();
  const written = await db.from("riftbound_cards").upsert(cards.map((r) => ({ ...r, updated_at })), { onConflict: "id" });
  if (written.error) throw new Error(`riftbound_cards upsert: ${written.error.message}`);
  const printed = await db.from("riftbound_printings").upsert(printings.map((r) => ({ ...r, updated_at })), { onConflict: "id" });
  if (printed.error) throw new Error(`riftbound_printings upsert: ${printed.error.message}`);
  log("info", "riftbound_catalogue_loaded", { cards: cards.length });
}

client.once(Events.ClientReady, async (c) => {
  log("info", "ready", { user: c.user.tag, servers: c.guilds.cache.size });
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  setInterval(() => void periodicFlush(), FLUSH_MS);
  void rotatePresence();
  setInterval(() => void rotatePresence(), PRESENCE_MS);
  void tracked("riftbound_catalogue", loadCatalogue());
  monthlyRecaps();
  setInterval(monthlyRecaps, REPORT_CHECK_MS);
  setInterval(() => void refreshRanks(), RANKS_MS);
  setInterval(() => void refreshAllMatches(), MATCHES_MS);
  // An overdue report waits for the games played while the bot was down.
  void refreshAllMatches().finally(() => {
    weeklyReports();
    setInterval(weeklyReports, REPORT_CHECK_MS);
  });
  for (const guild of c.guilds.cache.values()) await startServer(guild);
  // After startServer: the role sync needs every server's members cached.
  void refreshRanks();
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
  gameBuffer.add(games.closeAll(new Date()));
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
for (const b of boundaries) servers.set(b.guild_id, newServer(b.guild_id, b.before_id));
// Before login, so no report or command runs on the defaults of a configured server.
// shortcut: PostgREST returns at most 1000 rows; beyond that many servers, page this.
const { data: savedSettings, error: settingsError } = await db
  .from("guild_settings")
  .select("guild_id, report_channel_id, timezone, public_totals_opt_out, rank_roles");
if (settingsError) throw new Error(`guild_settings: ${settingsError.message}`);
for (const { guild_id, ...row } of savedSettings) settings.set(guild_id, row);
await client.login(config.discordToken);
