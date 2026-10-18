/** Where to post the welcome: the system channel if the bot can write there, else the first channel it can. */
export function welcomeChannel<T extends { sendable: boolean }>(system: T | null, channels: T[]): T | null {
  if (system?.sendable) return system;
  return channels.find((c) => c.sendable) ?? null;
}

/** The one message the bot posts when it joins a server. */
export function welcomeText(guildId: string, siteUrl: string | null): string {
  const page = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/s/${guildId}/leaderboard` : null;
  return [
    "Hi! I am ni han bao. I count messages, reactions, joins and voice time in this server, never what anyone writes.",
    ...(page ? [`See this server's stats (members only, log in with Discord): ${page}`] : []),
    "Use /hide-me to leave yourself out of every list and chart, and /show-me to come back.",
  ].join("\n");
}
