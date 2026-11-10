/** A server's guilds row: `left_at` is when the bot left it, null while it is in it. */
export interface StoredServer {
  guild_id: string;
  left_at: string | null;
}

/**
 * What the retention job does with the stored servers, given the ids of those the bot is in:
 * `markLeft` are stored as present but gone (removed while the bot was offline), `forget` are
 * already marked left. forget_guild() decides whether their 30 days are over. A server the
 * bot is in is never forgotten, even if a race left it marked.
 */
export function retentionPlan(stored: StoredServer[], inBot: Set<string>): { markLeft: string[]; forget: string[] } {
  const gone = stored.filter((s) => !inBot.has(s.guild_id));
  return {
    markLeft: gone.filter((s) => s.left_at === null).map((s) => s.guild_id),
    forget: gone.filter((s) => s.left_at !== null).map((s) => s.guild_id),
  };
}
