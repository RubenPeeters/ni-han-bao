// One-off, not part of the running bot: counts messages sent before live counting began
// (backfillBefore in history.ts), one channel or thread at a time, and adds them to the stats (the backfill
// migration says why that never double counts). Run with the live bot's env, after a build:
// `pnpm --filter ni-han-bao-bot backfill [--dry-run]`, e.g. on the box:
// `docker compose -f bot/deploy/compose.yaml run --rm bot node bot/dist/backfill.js --dry-run`.
// Safe to rerun: it resumes from the cursors in backfill_cursors and never counts a page twice.
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
import { backfillChannel, loadBeforeId, must, snowflakeTime, type Cursor, type HistoryIo } from "./history.js";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
if (!config.guildId) throw new Error("missing environment variable: DISCORD_GUILD_ID (the server to backfill)");
const guildId = config.guildId;
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});
// No MessageContent intent: fetched history comes back without its text. GuildMembers fills
// the member cache, so authors get their server nickname and avatar.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

/** Every channel gets a cursor up front, including ones unreadable on earlier runs. */
async function loadCursors(channelIds: string[], beforeId: string): Promise<Map<string, Cursor>> {
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

/** Existing rows are left alone: the live bot keeps names current, and members carry the opt-out. */
async function insertMissing(table: "members" | "channels", rows: (MemberRow | ChannelRow)[]): Promise<void> {
  const { error } = await db
    .from(table)
    .upsert(rows.map((r) => ({ ...r, guild_id: guildId })), {
      onConflict: table === "members" ? "guild_id,user_id" : "guild_id,channel_id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`${table} upsert: ${error.message}`);
}

async function main(): Promise<void> {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(guildId);
  await guild.members.fetch();
  const me = await guild.members.fetchMe();
  const channels = [...(await guild.channels.fetch()).values()].flatMap((c) =>
    c && c.isTextBased() && !c.isThread() ? [c] : [],
  );
  const readable = [...channels, ...(await allThreads(guild, me))].filter((c) =>
    c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  const beforeId = await loadBeforeId(db, guildId, !dryRun);
  // Messages sent between now and a future boundary would be missed: neither side counts them.
  const liveFrom = snowflakeTime(beforeId);
  if (liveFrom > new Date()) {
    console.error(`live counting starts at ${liveFrom.toISOString()}; run the backfill after that`);
    process.exitCode = 1;
    return;
  }
  console.log(`counting messages before id ${beforeId}${dryRun ? " (dry run: nothing is written)" : ""}`);
  const cursors = await loadCursors(readable.map((c) => c.id), beforeId);
  let total = 0;
  let failed = 0;
  // One channel at a time; discord.js waits out rate limits (429s) on its own.
  for (const channel of readable) {
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
        if (dryRun) return true;
        // Counts reference both, so they go first.
        if (page.members.length) await insertMissing("members", page.members);
        if (page.counts.length) await insertMissing("channels", [row]);
        return must(
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
      },
    };
    try {
      const counted = await backfillChannel(row, cursor, guildId, io);
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
