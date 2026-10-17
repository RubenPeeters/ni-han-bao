import { Client, Events, GatewayIntentBits } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.js";

const HEARTBEAT_MS = 60_000;

const config = loadConfig();
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
});

async function heartbeat(): Promise<void> {
  const guild = await client.guilds.fetch(config.guildId);
  const { error } = await db.from("bot_status").upsert({
    id: 1,
    guild_id: guild.id,
    guild_name: guild.name,
    member_count: guild.memberCount,
    last_seen: new Date().toISOString(),
  });
  if (error) console.error("heartbeat failed:", error.message);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`logged in as ${c.user.tag}`);
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
});

const shutdown = () => {
  void client.destroy().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await client.login(config.discordToken);
