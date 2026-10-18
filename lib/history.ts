/** Share of channels done, rounded down so it reads 100% only once the bot marks it done. */
export function historyPercent(done: number, total: number | null): number {
  return total ? Math.min(99, Math.floor((done * 100) / total)) : 0;
}

/** Days of member counts and joins before their trends mean anything: one full week. */
export const WARMUP_DAYS = 7;

const DISCORD_EPOCH = BigInt("1420070400000");

/** When the bot began counting live: the time in backfill_state.before_id (a snowflake). */
export function countingSince(beforeId: string): Date {
  return new Date(Number((BigInt(beforeId) >> BigInt(22)) + DISCORD_EPOCH));
}

/** Whether counting began less than WARMUP_DAYS ago, so live-only trends are still thin. */
export function warmingUp(since: Date, now: Date): boolean {
  return now.getTime() - since.getTime() < WARMUP_DAYS * 24 * 60 * 60_000;
}
