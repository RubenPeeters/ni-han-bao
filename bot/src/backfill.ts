// One-off: counts messages sent before a fixed cutoff, one channel or thread at a time, and
// raises the live counts to them (the backfill_cursors migration says why that is exact).
// Run next to the live bot (same env): `pnpm --filter ni-han-bao-bot backfill [--dry-run]`
// after a build, or `node bot/dist/backfill.js` in the container. Safe to rerun: it resumes
// from the cursors in backfill_cursors and never counts a page twice.
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  type AnyThreadChannel,
  type Guild,
  type GuildMember,
} from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { channelRow, memberRow, type MemberRow, type ChannelRow } from "./activity.js";
import { loadConfig } from "./config.js";
import { backfillChannel, backfillCutoff, snowflakeAt, type Cursor, type HistoryIo } from "./history.js";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});
// No MessageContent intent: fetched history comes back without its text. GuildMembers fills
// the member cache, so authors get their server nickname and avatar.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function must<T>(what: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/** Fixed by the first real run: later runs must count up to the same moment. */
async function loadCutoff(): Promise<Date> {
  const fresh = { cutoff: backfillCutoff(new Date()).toISOString() };
  if (!dryRun) {
    must("backfill_state", await db.from("backfill_state").upsert(fresh, { ignoreDuplicates: true }));
  }
  const [stored] = (must("backfill_state", await db.from("backfill_state").select("cutoff")) ?? []) as {
    cutoff: string;
  }[];
  return new Date(stored?.cutoff ?? fresh.cutoff);
}

/** Every channel gets a cursor at the cutoff, including ones unreadable or missing on earlier runs. */
async function loadCursors(channelIds: string[], cutoff: Date): Promise<Map<string, Cursor>> {
  const fresh = channelIds.map((id) => ({ channel_id: id, before_id: snowflakeAt(cutoff) }));
  if (!dryRun) {
    must("backfill_cursors", await db.from("backfill_cursors").upsert(fresh, { ignoreDuplicates: true }));
  }
  const rows = must(
    "backfill_cursors",
    await db.from("backfill_cursors").select("channel_id, before_id, done"),
  ) as { channel_id: string; before_id: string; done: boolean }[];
  const cursors = new Map(fresh.map((r) => [r.channel_id, { channelId: r.channel_id, beforeId: r.before_id, done: false }]));
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
      do {
        const page = await channel.threads.fetchArchived({ type, fetchAll: true, before, limit: 100 }, false);
        threads.push(...page.threads.values());
        // shortcut: threads archived in the same millisecond across a page break are skipped; fine for one server.
        before = page.hasMore ? (page.threads.last()?.archivedAt ?? undefined) : undefined;
      } while (before);
    }
  }
  return threads;
}

async function insertMissing(table: "members" | "channels", rows: (MemberRow | ChannelRow)[]) {
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
  const cutoff = await loadCutoff();
  console.log(`counting messages before ${cutoff.toISOString()}`);
  const cursors = await loadCursors(readable.map((c) => c.id), cutoff);
  let total = 0;
  // One channel at a time; discord.js waits out rate limits (429s) on its own.
  for (const channel of readable) {
    // Not channelRow(channel): a channel's discord.js parent is its category, a thread's its channel.
    const row = channelRow({ id: channel.id, name: channel.name, parent: channel.isThread() ? channel.parent : null });
    const cursor = cursors.get(channel.id)!;
    if (cursor.done) continue;
    if (!dryRun) await insertMissing("channels", [row]);
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
        if (page.members.length) await insertMissing("members", page.members);
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
        ) as boolean;
      },
    };
    const counted = await backfillChannel(row, cursor, config.guildId, io);
    total += counted;
    console.log(`#${channel.name}: ${dryRun ? "would read" : "read"} ${counted} messages`);
  }
  if (!dryRun) must("backfill_apply", await db.rpc("backfill_apply"));
  console.log(`${dryRun ? "would read" : "read"} ${total} messages in total`);
}

try {
  await main();
} finally {
  await client.destroy();
}
