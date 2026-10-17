import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type MessageReaction,
  Partials,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import {
  ActivityBuffer,
  channelRow,
  flushActivity,
  memberRow,
  shouldCount,
  utcDay,
  type MemberRow,
} from "./activity.js";
import { Backoff, flushUntil, InFlight } from "./backoff.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { emojiRow, flushReactions, ReactionBuffer, receivesReaction } from "./reactions.js";
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
import { flushTimeline, TimelineBuffer, VoiceSessions } from "./timeline.js";
import { hiddenFor, setVisibility, VISIBILITY_COMMANDS } from "./visibility.js";

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 10_000;
// Docker stop waits 10 s after SIGTERM before it kills the container.
const SHUTDOWN_DEADLINE_MS = 8_000;
const SHUTDOWN_KILL_MS = 9_500;

const config = loadConfig();
const log = createLogger(config.guildId);
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
  const guild = await client.guilds.fetch(config.guildId);
  const { error } = await db.from("bot_status").upsert({
    id: 1,
    guild_id: guild.id,
    guild_name: guild.name,
    member_count: guild.memberCount,
    avatar_url: client.user?.displayAvatarURL({ size: 256 }) ?? null,
    last_seen: new Date().toISOString(),
  });
  if (error) log("error", "heartbeat_failed", { error: error.message });
  // Rewritten every heartbeat, so each day keeps the last count seen that day.
  const snapshot = await db.from("member_count_snapshots").upsert({
    day: utcDay(new Date()),
    member_count: guild.memberCount,
    updated_at: new Date().toISOString(),
  });
  if (snapshot.error) {
    log("error", "member_count_snapshot_failed", { error: snapshot.error.message });
  }
}

const activity = new ActivityBuffer();

let flushing: Promise<boolean> | null = null;
// Flushes and reaction lookups started before shutdown; they may still add or write counts.
const inFlight = new InFlight();

const reactions = new ReactionBuffer();

const timeline = new TimelineBuffer();
const voice = new VoiceSessions();

async function upsertMembers(rows: MemberRow[]): Promise<void> {
  const { error } = await db
    .from("members")
    .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (error) throw new Error(`members upsert: ${error.message}`);
}

/** Logs each stream that failed and reports whether all of them were written. */
async function flushAll(): Promise<boolean> {
  let ok = true;
  const failed = (stream: string) => (err: unknown) => {
    ok = false;
    log("warn", "flush_failed", { stream, error: err });
  };
  await flushActivity(activity, {
    upsertMembers,
    async upsertChannels(rows) {
      const { error } = await db
        .from("channels")
        .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`channels upsert: ${error.message}`);
    },
    async incrementCounts(batch) {
      const { error } = await db.rpc("increment_activity", {
        batch: batch.id,
        counts: batch.counts,
        channel_counts: batch.channelCounts,
      });
      if (error) throw new Error(`increment_activity: ${error.message}`);
    },
  }).catch(failed("activity"));
  await flushReactions(reactions, {
    upsertMembers,
    async incrementReactions(batch) {
      const { error } = await db.rpc("increment_reactions", {
        batch: batch.id,
        emojis: batch.emojis,
        emoji_counts: batch.emojiCounts,
        received_counts: batch.receivedCounts,
      });
      if (error) throw new Error(`increment_reactions: ${error.message}`);
    },
  }).catch(failed("reactions"));
  // Count open voice sessions up to now, so a crash loses at most one flush interval.
  timeline.addVoice(voice.collect(new Date()));
  await flushTimeline(timeline, {
    upsertMembers,
    async incrementTimeline(batch) {
      const { error } = await db.rpc("increment_timeline", {
        batch: batch.id,
        flow: batch.flow,
        voice: batch.voice,
      });
      if (error) throw new Error(`increment_timeline: ${error.message}`);
    },
  }).catch(failed("timeline"));
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

/** Everything not yet written: buffered counts plus failed batches. */
function unwritten() {
  // Drain and put straight back: restore into the emptied maps is exact, and nothing
  // can run between the two calls.
  const a = activity.drain();
  const r = reactions.drain();
  const t = timeline.drain();
  activity.restore(a);
  reactions.restore(r);
  timeline.restore(t);
  return totals(
    [...a.counts, ...(activity.pending?.counts ?? [])],
    [...r.emojiCounts, ...(reactions.pending?.emojiCounts ?? [])],
    [...t.flow, ...(timeline.pending?.flow ?? [])],
    [...t.voice, ...(timeline.pending?.voice ?? [])],
  );
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
  const counted = shouldCount(
    {
      guildId: message.guildId,
      authorIsBot: message.author.bot,
      webhookId: message.webhookId,
      system: message.system,
    },
    config.guildId,
  );
  // inGuild() is implied by shouldCount; it is here to narrow the channel type.
  if (!counted || !message.inGuild()) return;
  const { channel } = message;
  const row = channelRow({
    id: channel.id,
    name: channel.name,
    parent: channel.isThread() ? channel.parent : null,
  });
  activity.addMessage(message.author.id, row.channel_id, message.createdAt);
  activity.setMember(memberRow(message.author, message.member));
  activity.setChannel(row);
});

// Removals are ignored on purpose (see ReactionBuffer), so there is no MessageReactionRemove.
client.on(Events.MessageReactionAdd, (reaction, user) => void inFlight.track(countReaction(reaction, user)));

async function countReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  const { message } = reaction;
  if (user.bot || message.guildId !== config.guildId) return;
  const emoji = emojiRow(reaction.emoji);
  if (!emoji) return;
  const at = new Date();
  reactions.addEmoji(emoji, at);
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
    if (receivesReaction(author, user.id, config.guildId)) {
      reactions.addReceived(memberRow(full.author, full.member), at);
    }
  } catch (err) {
    log("error", "reaction_author_lookup_failed", { error: err });
  }
}

// Renames while the bot is offline are picked up by the channel's next message.
client.on(Events.ChannelUpdate, (_old, channel) => {
  if (channel.isDMBased() || channel.isThread() || channel.guildId !== config.guildId) return;
  activity.setChannel(channelRow({ id: channel.id, name: channel.name }));
});

client.on(Events.GuildMemberUpdate, (_old, member) => {
  if (member.guild.id === config.guildId && !member.user.bot) {
    activity.setMember(memberRow(member.user, member));
  }
});

// Global name and avatar changes arrive only as UserUpdate: discord.js emits
// GuildMemberUpdate just for guild-level changes (nickname, guild avatar, roles).
client.on(Events.UserUpdate, (_old, user) => {
  if (user.bot) return;
  // The member cache is complete (fetched on ready, kept current by the GuildMembers
  // intent), so a miss means the user is not in our server and gets no row.
  const member = client.guilds.cache.get(config.guildId)?.members.cache.get(user.id);
  if (member) activity.setMember(memberRow(user, member));
});

// Bots count here, unlike everywhere else: the member count the timeline shows is
// Discord's, which includes them, and joins minus leaves should add up to it.
client.on(Events.GuildMemberAdd, (member) => {
  if (member.guild.id === config.guildId) timeline.addJoin(new Date());
});

client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id === config.guildId) timeline.addLeave(new Date());
});

client.on(Events.VoiceStateUpdate, (_old, state) => {
  if (state.guild.id !== config.guildId) return;
  if (state.channelId === null) {
    // No member check on a leave: an uncached member must still close their session, and
    // a bot never has one to close.
    timeline.addVoice(voice.update(state.id, false, new Date()));
    return;
  }
  if (!state.member || state.member.user.bot) return;
  timeline.setMember(memberRow(state.member.user, state.member));
  voice.update(state.id, true, new Date());
});

// shortcut: rank needs every member's total, fetched via leaderboard() up to this many rows
// (and PostgREST's max-rows, 1000 by default); add a rank function if the server outgrows it.
const RANK_TOP = 1000;

async function leaderboard(since: string | null, top: number) {
  const { data, error } = await db.rpc("leaderboard", { since, top });
  if (error) throw new Error(`leaderboard: ${error.message}`);
  return data as { user_id: string; display_name: string; message_count: number }[];
}

// Reads only, from the tables and functions the website uses. The secret key bypasses RLS,
// so hidden members are filtered by leaderboard() itself, and /me can read the caller's own rows.
async function statsReply(interaction: ChatInputCommandInteraction<"cached">) {
  const weekStart = utcWeekStart(new Date());
  if (interaction.commandName === "leaderboard") {
    const period: Period = interaction.options.getString("period") === "all" ? "all" : "week";
    const rows = await leaderboard(period === "week" ? weekStart : null, 10);
    return { embeds: [leaderboardEmbed(period, rows, weekStart, config.siteUrl)] };
  }
  if (interaction.commandName === "me") {
    const userId = interaction.user.id;
    const [counts, received, member, week, allTime] = await Promise.all([
      db.from("message_counts").select("day, count").eq("user_id", userId),
      db.from("reactions_received").select("day, count").eq("user_id", userId),
      db.from("members").select("hidden").eq("user_id", userId).maybeSingle(),
      leaderboard(weekStart, RANK_TOP),
      leaderboard(null, RANK_TOP),
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
    .eq("channel_id", target.id)
    .gte("hour", new Date(Date.now() - CHANNEL_DAYS * 24 * 60 * 60_000).toISOString());
  if (error) throw new Error(`channel_message_counts: ${error.message}`);
  return { embeds: [channelEmbed(target.name, data, config.siteUrl)] };
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  if (interaction.guildId !== config.guildId) return;
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
          const { error } = await db
            .from("members")
            .upsert({ ...row, hidden: flag, updated_at: new Date().toISOString() });
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

client.once(Events.ClientReady, async (c) => {
  log("info", "ready", { user: c.user.tag });
  // Guild commands, not global ones: they apply instantly and only in our server.
  try {
    await c.application.commands.set([...VISIBILITY_COMMANDS, ...STATS_COMMANDS], config.guildId);
  } catch (err) {
    log("error", "command_registration_failed", { error: err });
  }
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  setInterval(() => void periodicFlush(), FLUSH_MS);
  // Names and avatars may have changed while the bot was offline.
  try {
    const guild = await c.guilds.fetch(config.guildId);
    for (const member of (await guild.members.fetch()).values()) {
      if (!member.user.bot) activity.setMember(memberRow(member.user, member));
    }
    // Whoever was in voice before the bot started is counted from now on.
    const inVoice = [...guild.voiceStates.cache.values()].flatMap((s) =>
      s.channelId !== null && s.member && !s.member.user.bot ? [s.member] : [],
    );
    for (const m of inVoice) timeline.setMember(memberRow(m.user, m));
    timeline.addVoice(voice.sync(inVoice.map((m) => m.id), new Date()));
  } catch (err) {
    log("error", "member_sync_failed", { error: err });
  }
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
  timeline.addVoice(voice.closeAll(new Date()));
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

await client.login(config.discordToken);
