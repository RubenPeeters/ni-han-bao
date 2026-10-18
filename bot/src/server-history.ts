// Counts one server's messages sent before live counting began (backfillBefore in
// history.ts), one channel or thread at a time, and adds them to the stats (the backfill
// migration says why that never double counts). Run by the bot for each server it is in
// until done, and by the backfill script. Safe to rerun: it resumes from the cursors in
// backfill_cursors and never counts a page twice.
import { PermissionFlagsBits, type AnyThreadChannel, type Guild, type GuildMember } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelRow, memberRow, type ChannelRow, type MemberRow } from "./activity.js";
import {
  backfillChannel,
  backfillComplete,
  backfillProgress,
  loadBeforeId,
  must,
  snowflakeTime,
  type Cursor,
  type HistoryIo,
} from "./history.js";
import type { Level } from "./log.js";

export interface BackfillOptions {
  /** Count but write nothing, progress included. */
  dryRun?: boolean;
  log: (level: Level, event: string, fields?: Record<string, unknown>) => void;
  /** Checked before each channel: the bot stops between channels when it shuts down. */
  stopped?: () => boolean;
}

/** Every channel gets a cursor up front, including ones unreadable on earlier runs. */
async function loadCursors(
  db: SupabaseClient,
  guildId: string,
  channelIds: string[],
  beforeId: string,
  dryRun: boolean,
): Promise<Map<string, Cursor>> {
  const cursors = new Map<string, Cursor>(channelIds.map((id) => [id, { beforeId, done: false }]));
  if (!dryRun) {
    const { error } = await db
      .from("backfill_cursors")
      .upsert(channelIds.map((channel_id) => ({ guild_id: guildId, channel_id, before_id: beforeId })), {
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`backfill_cursors upsert: ${error.message}`);
  }
  // Paged: PostgREST caps a select at 1000 rows, and a cursor missing here would restart its
  // channel from the top, where the first page is refused and the channel never finishes.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const rows: { channel_id: string; before_id: string; done: boolean }[] = must(
      "backfill_cursors",
      await db
        .from("backfill_cursors")
        .select("channel_id, before_id, done")
        .eq("guild_id", guildId)
        .order("channel_id")
        .range(from, from + PAGE - 1),
    );
    for (const r of rows) cursors.set(r.channel_id, { beforeId: r.before_id, done: r.done });
    if (rows.length < PAGE) return cursors;
  }
}

/**
 * Active plus archived threads: the live bot counts their messages toward the parent.
 * `failed` counts listings that threw: their threads are missing, so the server is not done.
 */
async function allThreads(
  guild: Guild,
  me: GuildMember,
  options: BackfillOptions,
): Promise<{ threads: AnyThreadChannel[]; failed: number }> {
  let failed = 0;
  const threads = [...(await guild.channels.fetchActiveThreads(false)).threads.values()];
  for (const channel of guild.channels.cache.values()) {
    if (!("threads" in channel) || !channel.permissionsFor(me).has(PermissionFlagsBits.ReadMessageHistory)) continue;
    // Listing other members' archived private threads needs Manage Threads.
    const types = channel.permissionsFor(me).has(PermissionFlagsBits.ManageThreads)
      ? (["public", "private"] as const)
      : (["public"] as const);
    for (const type of types) {
      let before: Date | undefined;
      try {
        do {
          const page = await channel.threads.fetchArchived({ type, fetchAll: true, before, limit: 100 }, false);
          threads.push(...page.threads.values());
          // shortcut: threads archived in the same millisecond across a page break are skipped; fine for one server.
          before = page.hasMore ? (page.threads.last()?.archivedAt ?? undefined) : undefined;
        } while (before);
      } catch (err) {
        // One unlistable channel must not stop the rest; a rerun lists it again.
        options.log("error", "backfill_thread_list_failed", { guild: guild.id, channel: channel.id, type, error: err });
        failed++;
      }
    }
  }
  return { threads, failed };
}

/** Existing rows are left alone: the live bot keeps names current, and members carry the opt-out. */
async function insertMissing(
  db: SupabaseClient,
  guildId: string,
  table: "members" | "channels",
  rows: (MemberRow | ChannelRow)[],
): Promise<void> {
  const { error } = await db
    .from(table)
    .upsert(rows.map((r) => ({ ...r, guild_id: guildId })), {
      onConflict: table === "members" ? "guild_id,user_id" : "guild_id,channel_id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`${table} upsert: ${error.message}`);
}

/**
 * Backfills one server whose member cache is filled (authors get their server nickname and
 * avatar). Returns whether every readable channel is done and every thread list was read; the server is then marked done
 * in backfill_state. One channel at a time; discord.js waits out rate limits (429s) on its own.
 */
export async function backfillGuild(db: SupabaseClient, guild: Guild, options: BackfillOptions): Promise<boolean> {
  const { dryRun = false, log, stopped = () => false } = options;
  const guildId = guild.id;
  const me = await guild.members.fetchMe();
  const channels = [...(await guild.channels.fetch()).values()].flatMap((c) =>
    c && c.isTextBased() && !c.isThread() ? [c] : [],
  );
  const threads = await allThreads(guild, me, options);
  const readable = [...channels, ...threads.threads].filter((c) =>
    c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  const beforeId = await loadBeforeId(db, guildId, !dryRun);
  // Messages sent between now and a future boundary would be missed: neither side counts them.
  const liveFrom = snowflakeTime(beforeId);
  if (liveFrom > new Date()) throw new Error(`live counting starts at ${liveFrom.toISOString()}; backfill after that`);
  log("info", "backfill_started", { guild: guildId, before_id: beforeId, channels: readable.length, dry_run: dryRun });
  const all = await loadCursors(db, guildId, readable.map((c) => c.id), beforeId, dryRun);
  // Only this run's channels: a deleted channel's cursor never finishes.
  const cursors = new Map(readable.map((c) => [c.id, all.get(c.id)!]));

  const saveProgress = async (done: boolean) => {
    if (dryRun) return;
    const { error } = await db
      .from("backfill_state")
      .update({ ...backfillProgress([...cursors.values()]), done_at: done ? new Date().toISOString() : null })
      .eq("guild_id", guildId);
    if (error) throw new Error(`backfill_state update: ${error.message}`);
  };
  await saveProgress(false);

  let total = 0;
  let failed = threads.failed;
  for (const channel of readable) {
    if (stopped()) return false;
    const cursor = cursors.get(channel.id)!;
    if (cursor.done) continue;
    // A channel's discord.js parent is its category, so only a thread passes one.
    const row = channelRow({ id: channel.id, name: channel.name, parent: channel.isThread() ? channel.parent : null });
    const io: HistoryIo = {
      async fetchBefore(before, limit) {
        const page = await channel.messages.fetch({ before, limit, cache: false });
        return page.map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          guildId: m.guildId,
          authorIsBot: m.author.bot,
          webhookId: m.webhookId,
          system: m.system,
          author: memberRow(m.author, m.member),
        }));
      },
      async writePage(page) {
        if (!dryRun) {
          // Counts reference both, so they go first.
          if (page.members.length) await insertMissing(db, guildId, "members", page.members);
          if (page.counts.length) await insertMissing(db, guildId, "channels", [row]);
          const applied: boolean = must(
            "backfill_page",
            await db.rpc("backfill_page", {
              guild: guildId,
              channel: channel.id,
              before: page.beforeId,
              next_before: page.nextBeforeId,
              finished: page.done,
              counts: page.counts,
              channel_counts: page.channelCounts,
              member_channel_counts: page.memberChannelCounts,
            }),
          );
          if (!applied) return false;
        }
        cursors.set(channel.id, { beforeId: page.nextBeforeId, done: page.done });
        return true;
      },
    };
    try {
      const counted = await backfillChannel(row, cursor, guildId, io);
      total += counted;
      log("info", "backfill_channel_done", { guild: guildId, channel: channel.id, into: row.channel_id, counted });
    } catch (err) {
      // Pages already written stay counted and the cursor stays not-done, so a rerun
      // resumes here; the other channels still get counted.
      log("error", "backfill_channel_failed", { guild: guildId, channel: channel.id, error: err });
      failed++;
    }
    await saveProgress(false);
  }
  const done = backfillComplete(failed, [...cursors.values()]);
  await saveProgress(done);
  log(done ? "info" : "warn", "backfill_finished", { guild: guildId, counted: total, failures: failed, dry_run: dryRun });
  return done;
}
