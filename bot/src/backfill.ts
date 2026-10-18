// One-off: counts messages sent before the live bot's first counted day, one channel or
// thread at a time, and adds them to the stats (the backfill_cursors migration says why
// that never double counts). Run with the live bot's env, after a build:
// `pnpm --filter ni-han-bao-bot backfill [--dry-run]`. Safe to rerun: it resumes from the
// cursors in backfill_cursors and never counts a page twice.
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  type AnyThreadChannel,
  type Guild,
  type GuildMember,
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { channelRow, memberRow, type ChannelRow, type MemberRow } from "./activity.js";
import { loadConfig } from "./config.js";
import { backfillBoundary, backfillChannel, snowflakeAt, type Cursor, type HistoryIo } from "./history.js";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});
// No MessageContent intent: fetched history comes back without its text. GuildMembers fills
// the member cache, so authors get their server nickname and avatar.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

/** Throws on a failed query; data is only null when there is an error. */
function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
}

/** Fixed by the first real run, so later runs stop at the same moment. */
async function loadBoundary(): Promise<Date> {
  const [stored] = must("backfill_state", await db.from("backfill_state").select("boundary"));
  if (stored) return new Date(stored.boundary);
  const [first] = must(
    "message_counts",
    await db.from("message_counts").select("day").order("day").limit(1),
  );
  const boundary = { boundary: backfillBoundary(first?.day ?? null, new Date()).toISOString() };
  if (dryRun) return new Date(boundary.boundary);
  must("backfill_state", await db.from("backfill_state").upsert(boundary, { ignoreDuplicates: true }));
  // Re-read: a concurrent first run may have stored its boundary first.
  const [row] = must("backfill_state", await db.from("backfill_state").select("boundary"));
  return new Date(row.boundary);
}

/** Every channel gets a cursor at the boundary, including ones unreadable on earlier runs. */
async function loadCursors(channelIds: string[], boundary: Date): Promise<Map<string, Cursor>> {
  const fresh = channelIds.map((id) => ({ channel_id: id, before_id: snowflakeAt(boundary) }));
  if (!dryRun) {
    must("backfill_cursors", await db.from("backfill_cursors").upsert(fresh, { ignoreDuplicates: true }));
  }
  const rows: { channel_id: string; before_id: string; done: boolean }[] = must(
    "backfill_cursors",
    await db.from("backfill_cursors").select("channel_id, before_id, done"),
  );
  const cursors = new Map<string, Cursor>(
    fresh.map((r) => [r.channel_id, { channelId: r.channel_id, beforeId: r.before_id, done: false }]),
  );
  for (const r of rows) cursors.set(r.channel_id, { channelId: r.channel_id, beforeId: r.before_id, done: r.done });
  return cursors;
}

/** Active plus archived threads: the live bot counts their messages toward the parent. */
async function allThreads(guild: Guild, me: GuildMember): Promise<AnyThreadChannel[]> {
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
        console.error(`#${channel.name} (${channel.id}): listing ${type} archived threads failed:`, err);
      }
    }
  }
  return threads;
}

async function insertMissing(table: "members" | "channels", rows: (MemberRow | ChannelRow)[]): Promise<void> {
  // Existing rows are left alone: the live bot keeps names current, and members carry the opt-out.
  must(table, await db.from(table).upsert(rows, { ignoreDuplicates: true }));
}

async function main(): Promise<void> {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.guildId);
  await guild.members.fetch();
  const me = await guild.members.fetchMe();
  const channels = [...(await guild.channels.fetch()).values()].flatMap((c) =>
    c && c.isTextBased() && !c.isThread() ? [c] : [],
  );
  const readable = [...channels, ...(await allThreads(guild, me))].filter((c) =>
    c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  const boundary = await loadBoundary();
  console.log(`counting messages before ${boundary.toISOString()}${dryRun ? " (dry run: nothing is written)" : ""}`);
  const cursors = await loadCursors(readable.map((c) => c.id), boundary);
  let total = 0;
  let failed = 0;
  // One channel at a time; discord.js waits out rate limits (429s) on its own.
  for (const channel of readable) {
    // Not channelRow(channel): a channel's discord.js parent is its category, a thread's its channel.
    const row = channelRow({ id: channel.id, name: channel.name, parent: channel.isThread() ? channel.parent : null });
    const cursor = cursors.get(channel.id)!;
    if (cursor.done) continue;
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
        if (dryRun) return true;
        // Counts reference both, so they go first.
        if (page.members.length) await insertMissing("members", page.members);
        if (page.counts.length) await insertMissing("channels", [row]);
        return must(
          "backfill_page",
          await db.rpc("backfill_page", {
            channel: page.channelId,
            before: page.beforeId,
            next_before: page.nextBeforeId,
            finished: page.done,
            counts: page.counts,
            channel_counts: page.channelCounts,
          }),
        );
      },
    };
    try {
      const counted = await backfillChannel(row, cursor, config.guildId, io);
      total += counted;
      const into = row.channel_id === channel.id ? "" : ` (into #${row.name})`;
      console.log(`#${channel.name}${into}: ${dryRun ? "would add" : "added"} ${counted} messages`);
    } catch (err) {
      // Pages already written stay counted and the cursor stays not-done, so a rerun
      // resumes here; the other channels still get counted.
      console.error(`#${channel.name} (${channel.id}): skipped:`, err);
      failed++;
    }
  }
  console.log(`${dryRun ? "would add" : "added"} ${total} messages in total`);
  if (failed) {
    console.error(`${failed} channels failed; rerun to retry them`);
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await client.destroy();
}
