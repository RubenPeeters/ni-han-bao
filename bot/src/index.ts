import { Client, Events, GatewayIntentBits, type GuildMember, type User } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { ActivityBuffer, displayName, shouldCount, type MemberRow } from "./activity.js";
import { loadConfig } from "./config.js";

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 10_000;

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

const activity = new ActivityBuffer();

function profile(user: User, member: GuildMember | null): MemberRow {
  return {
    user_id: user.id,
    display_name: displayName({
      nickname: member?.nickname ?? null,
      globalName: user.globalName,
      username: user.username,
    }),
    avatar_url: (member ?? user).displayAvatarURL(),
  };
}

async function writeBatch(): Promise<void> {
  const batch = activity.drain();
  if (batch.members.length) {
    // Members first: message_counts references them.
    const { error } = await db.from("members").upsert(
      batch.members.map((m) => ({ ...m, updated_at: new Date().toISOString() })),
    );
    if (error) {
      console.error("member upsert failed:", error.message);
      activity.restore(batch);
      return;
    }
  }
  if (batch.counts.length) {
    const { error } = await db.rpc("increment_message_counts", { p_rows: batch.counts });
    if (error) {
      console.error("count flush failed:", error.message);
      activity.restore({ members: [], counts: batch.counts });
    }
  }
}

// Chained so a slow write never overlaps the next one and reorders profile updates.
let flushing = Promise.resolve();
function flush(): Promise<void> {
  flushing = flushing
    .then(() => (activity.isEmpty ? undefined : writeBatch()))
    // A rejected link would stall every later flush.
    .catch((err) => console.error("flush failed:", err));
  return flushing;
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
  if (!counted) return;
  activity.member(profile(message.author, message.member));
  activity.message(message.author.id, message.createdAt);
});

client.on(Events.GuildMemberUpdate, (_, member) => {
  if (member.guild.id !== config.guildId || member.user.bot) return;
  activity.member(profile(member.user, member));
});

client.once(Events.ClientReady, async (c) => {
  console.log(`logged in as ${c.user.tag}`);
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  setInterval(() => void flush(), FLUSH_MS);
});

const shutdown = () => {
  void flush()
    .then(() => client.destroy())
    .finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await client.login(config.discordToken);
