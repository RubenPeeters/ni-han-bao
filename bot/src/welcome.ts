/** What the bot says once in a server it joins: what it counts, where to see it, how to opt out. */
export function welcomeText(siteUrl: string | null, guildId: string): string {
  const link = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/s/${guildId}/leaderboard` : null;
  return [
    "Hi, I'm nexus! I count messages, reactions and voice time in this server: " +
      "counts and timestamps only, never what anyone writes.",
    ...(link ? [`See the stats (members only, log in with Discord): ${link}`] : []),
    "Rather not appear in the lists and charts? Use /hide-me, and /show-me to come back.",
  ].join("\n");
}

/** The system channel if the bot can post there, else the first channel it can post in. */
export function welcomeChannel<C>(system: C | null, byPosition: C[], canSend: (c: C) => boolean): C | null {
  return [system, ...byPosition].find((c): c is C => c !== null && canSend(c)) ?? null;
}

export interface WelcomeStore {
  /** Records the welcome; false when the server already had one. */
  claim(channelId: string): Promise<boolean>;
  release(): Promise<void>;
}

/** Claims before sending, so a second join event or a concurrent bot cannot post it twice. */
export async function postWelcome(
  store: WelcomeStore,
  channel: { id: string; send(text: string): Promise<unknown> } | null,
  text: string,
): Promise<"no_channel" | "already_welcomed" | "posted"> {
  if (!channel) return "no_channel";
  if (!(await store.claim(channel.id))) return "already_welcomed";
  try {
    await channel.send(text);
  } catch (err) {
    // Unclaimed again, so the next join can still welcome the server.
    await store.release();
    throw err;
  }
  return "posted";
}
