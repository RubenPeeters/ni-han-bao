import { Client, Events, GatewayIntentBits, type GuildMember, type User } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import { ActivityBuffer, displayName, flushActivity, shouldCount, type MemberRow } from "./activity.js";
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

// `member` can be missing on a message (e.g. uncached); fall back to the user so every
// counted author still gets a members row, which message_counts references.
function memberRow(user: User, member: GuildMember | null): MemberRow {
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

let flushing: Promise<void> | null = null;

// One flush at a time, so shutdown can wait for the one in flight before writing the rest.
function flush(): Promise<void> {
  flushing ??= flushActivity(activity, {
    async upsertMembers(rows) {
      const { error } = await db
        .from("members")
        .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`members upsert: ${error.message}`);
    },
    async incrementCounts(rows) {
      const { error } = await db.rpc("increment_message_counts", { counts: rows });
      if (error) throw new Error(`increment_message_counts: ${error.message}`);
    },
  })
    .catch((err: unknown) => console.error("activity flush failed:", err))
    .finally(() => {
      flushing = null;
    });
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
  activity.addMessage(message.author.id, message.createdAt);
  activity.setMember(memberRow(message.author, message.member));
});

client.on(Events.GuildMemberUpdate, (_old, member) => {
  if (member.guild.id === config.guildId && !member.user.bot) {
    activity.setMember(memberRow(member.user, member));
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`logged in as ${c.user.tag}`);
  await heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  setInterval(() => void flush(), FLUSH_MS);
  // Names and avatars may have changed while the bot was offline.
  try {
    const guild = await c.guilds.fetch(config.guildId);
    for (const member of (await guild.members.fetch()).values()) {
      if (!member.user.bot) activity.setMember(memberRow(member.user, member));
    }
  } catch (err) {
    console.error("member sync failed:", err);
  }
});

const shutdown = () => {
  // The first call waits for any flush already in flight, the second writes what is left.
  void flush()
    .then(() => flush())
    .finally(() => client.destroy())
    .finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await client.login(config.discordToken);
