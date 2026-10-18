const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * Per-day counts summed per week (from Monday, UTC) for the `weeks` weeks up to `now`, oldest
 * first, zeros filled in. Days outside that range are ignored.
 */
export function weeklyCounts(days: { day: string; count: number }[], now: Date, weeks: number) {
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const first = monday - (weeks - 1) * WEEK_MS;
  const result = Array.from({ length: weeks }, (_, i) => ({
    week: new Date(first + i * WEEK_MS).toISOString().slice(0, 10),
    count: 0,
  }));
  for (const d of days) {
    const i = Math.floor((Date.parse(d.day) - first) / WEEK_MS);
    if (i >= 0 && i < weeks) result[i].count += d.count;
  }
  return result;
}
