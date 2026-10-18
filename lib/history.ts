/** Share of channels done, rounded down so it reads 100% only once the bot marks it done. */
export function historyPercent(done: number, total: number | null): number {
  return total ? Math.min(99, Math.floor((done * 100) / total)) : 0;
}
