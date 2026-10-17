// One-off: counts messages sent before the bot's first live count, one text channel at a
// time. Run next to the live bot (same env): `pnpm --filter ni-han-bao-bot backfill [--dry-run]`
// after a build, or `node bot/dist/backfill.js` in the container. Safe to rerun: it resumes
// from the cursors in backfill_cursors and never counts a page twice.
import { Client, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { channelRow, memberRow, type ChannelRow, type MemberRow } from "./activity.js";
import { loadConfig } from "./config.js";
import { backfillChannel, firstLiveCount, snowflakeAt, type Cursor, type HistoryIo } from "./history.js";

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

/** Fixed on the first real run: later runs must not move it, since the backfill adds older counts. */
async function loadCursors(channels: ChannelRow[]): Promise<Map<string, Cursor>> {
  const rows = must(
    "backfill_cursors",
    await db.from("backfill_cursors").select("channel_id, before_id, done"),
  ) as { channel_id: string; before_id: string; done: boolean }[];
  if (rows.length) {
    return new Map(rows.map((r) => [r.channel_id, { beforeId: r.before_id, done: r.done }]));
  }
  const [day] =
    must("message_counts", await db.from("message_counts").select("day").order("day").limit(1)) ?? [];
  const [hour] =
    must("channel_message_counts", await db.from("channel_message_counts").select("hour").order("hour").limit(1)) ??
    [];
  const cutoff = firstLiveCount(day?.day ?? null, hour?.hour ?? null, new Date());
  console.log(`live counting began ${cutoff.toISOString()}; counting messages before that`);
  const fresh = channels.map((c) => ({ channel_id: c.channel_id, before_id: snowflakeAt(cutoff) }));
  if (!dryRun) {
    // One insert, so a crash cannot leave some channels with a cursor and others without.
    must("backfill_cursors", await db.from("backfill_cursors").upsert(fresh, { ignoreDuplicates: true }));
  }
  return new Map(fresh.map((r) => [r.channel_id, { beforeId: r.before_id, done: false }]));
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
  const textChannels = [...(await guild.channels.fetch()).values()].flatMap((c) =>
    c &&
    c.isTextBased() &&
    !c.isThread() &&
    c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
      ? [c]
      : [],
  );
  const cursors = await loadCursors(textChannels.map((c) => channelRow({ id: c.id, name: c.name })));
  let total = 0;
  // One channel at a time; discord.js waits out rate limits (429s) on its own.
  for (const channel of textChannels) {
    // Not channelRow(channel): a channel's discord.js parent is its category.
    const row = channelRow({ id: channel.id, name: channel.name });
    const cursor = cursors.get(row.channel_id);
    // No cursor: created after the first run (so nothing to backfill) or unreadable then.
    if (!cursor || cursor.done) continue;
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
    console.log(`#${row.name}: ${dryRun ? "would add" : "added"} ${counted} messages`);
  }
  console.log(`${dryRun ? "would add" : "added"} ${total} messages in total`);
}

try {
  await main();
} finally {
  await client.destroy();
}
