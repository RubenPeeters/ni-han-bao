import { Client, Events, GatewayIntentBits, MessageFlags, type VoiceState } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import {
  ActivityBuffer,
  channelRow,
  flushActivity,
  memberRow,
  shouldCount,
  utcDay,
} from "./activity.js";
import { loadConfig } from "./config.js";
import { hiddenFor, setVisibility, VISIBILITY_COMMANDS } from "./visibility.js";
import { VoiceTracker, type VoiceSecondsRow } from "./voice.js";

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
  const now = new Date();
  const { error } = await db.from("bot_status").upsert({
    id: 1,
    guild_id: guild.id,
    guild_name: guild.name,
    member_count: guild.memberCount,
    last_seen: now.toISOString(),
  });
  if (error) console.error("heartbeat failed:", error.message);
  // Rewritten every heartbeat, so each day ends up holding its last count.
  const snapshot = await db.from("member_count_days").upsert({
    day: utcDay(now),
    member_count: guild.memberCount,
    updated_at: now.toISOString(),
  });
  if (snapshot.error) console.error("member count snapshot failed:", snapshot.error.message);
}

const activity = new ActivityBuffer();
const voice = new VoiceTracker();

function addVoice(rows: VoiceSecondsRow[]): void {
  for (const row of rows) activity.addVoice(row);
}

/** The channel whose time counts, or null: AFK is idling, not hanging out. */
function countedChannel(state: VoiceState): string | null {
  return state.channelId && state.channelId !== state.guild.afkChannelId ? state.channelId : null;
}

/** Bring the sessions in line with the voice state cache, counting up to `at`. */
function syncVoice(at: Date): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const inVoice: string[] = [];
  for (const state of guild.voiceStates.cache.values()) {
    if (!countedChannel(state) || !state.member || state.member.user.bot) continue;
    // voice_seconds references members, so a newly seen member needs a row first.
    if (!voice.isOpen(state.id)) activity.setMember(memberRow(state.member.user, state.member));
    inVoice.push(state.id);
  }
  addVoice(voice.sync(inVoice, at));
}

let flushing: Promise<void> | null = null;
// Set once shutdown has closed the voice sessions, so the final flushes do not reopen them.
let stopping = false;

// One flush at a time, so shutdown can wait for the one in flight before writing the rest.
function flush(): Promise<void> {
  if (client.isReady() && !stopping) syncVoice(new Date());
  flushing ??= flushActivity(activity, {
    async upsertMembers(rows) {
      const { error } = await db
        .from("members")
        .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`members upsert: ${error.message}`);
    },
    async upsertChannels(rows) {
      const { error } = await db
        .from("channels")
        .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`channels upsert: ${error.message}`);
    },
    async incrementCounts(batch) {
      const { error } = await db.rpc("apply_activity", {
        batch: batch.id,
        counts: batch.counts,
        channel_counts: batch.channelCounts,
        voice_seconds: batch.voiceSeconds,
        member_flow: batch.memberFlow,
      });
      if (error) throw new Error(`apply_activity: ${error.message}`);
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

client.on(Events.VoiceStateUpdate, (_old, state) => {
  if (state.guild.id !== config.guildId || !state.member || state.member.user.bot) return;
  const channelId = countedChannel(state);
  if (channelId && !voice.isOpen(state.id)) {
    activity.setMember(memberRow(state.member.user, state.member));
  }
  addVoice(voice.update(state.id, channelId, new Date()));
});

// Bots count here too, like in the member count, so joins minus leaves matches its changes.
client.on(Events.GuildMemberAdd, (member) => {
  if (member.guild.id === config.guildId) activity.addJoin(new Date());
});

client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id === config.guildId) activity.addLeave(new Date());
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  if (interaction.guildId !== config.guildId) return;
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
    console.error(`/${interaction.commandName} failed:`, err);
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`logged in as ${c.user.tag}`);
  // Guild commands, not global ones: they apply instantly and only in our server.
  try {
    await c.application.commands.set([...VISIBILITY_COMMANDS], config.guildId);
  } catch (err) {
    console.error("command registration failed:", err);
  }
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
  // Whoever is in voice already starts counting now; time while the bot was down is lost.
  syncVoice(new Date());
});

const shutdown = () => {
  // Close open voice sessions now, so the time up to shutdown is written and nothing stays open.
  stopping = true;
  addVoice(voice.closeAll(new Date()));
  // The first call waits for any flush already in flight, the second writes what is left.
  void flush()
    .then(() => flush())
    .finally(() => client.destroy())
    .finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await client.login(config.discordToken);
