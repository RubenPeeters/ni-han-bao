// By hand: the bot backfills every server on its own (server-history.ts); this runs the same
// backfill for one server, e.g. to check it first with a dry run. Run with the live bot's
// env, after a build: `pnpm --filter ni-han-bao-bot backfill [--dry-run]`, e.g. on the box:
// `docker compose -f bot/deploy/compose.yaml run --rm bot node bot/dist/backfill.js --dry-run`.
// Safe to run next to the bot: both resume from the same cursors and never count a page twice.
import { Client, GatewayIntentBits } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { backfillGuild } from "./server-history.js";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
if (!config.guildId) throw new Error("missing environment variable: DISCORD_GUILD_ID (the server to backfill)");
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false },
});
// No MessageContent intent: fetched history comes back without its text. GuildMembers fills
// the member cache, so authors get their server nickname and avatar.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

try {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.guildId);
  await guild.members.fetch();
  const settings = await db.from("guild_settings").select("timezone").eq("guild_id", guild.id).maybeSingle();
  if (settings.error) throw new Error(`guild_settings: ${settings.error.message}`);
  const timeZone = settings.data?.timezone ?? "UTC";
  if (!(await backfillGuild(db, guild, { dryRun, log: createLogger(), timeZone }))) process.exitCode = 1;
} finally {
  await client.destroy();
}
