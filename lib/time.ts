const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto", style: "short" });
const exact = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Brussels",
  timeZoneName: "short",
});

// "5 sec ago", "2 min ago", "3 hr ago", "yesterday", "12 days ago".
export function formatRelative(date: Date, now: Date = new Date()): string {
  // Clamp: a timestamp slightly ahead of this server's clock is still "now", not "in 2 sec".
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 60) return relative.format(-sec, "second");
  if (sec < 3600) return relative.format(-Math.floor(sec / 60), "minute");
  if (sec < 86400) return relative.format(-Math.floor(sec / 3600), "hour");
  return relative.format(-Math.floor(sec / 86400), "day");
}

// The server is in Belgium; tooltips show its wall-clock time.
export const formatExact = (date: Date) => exact.format(date);

/** Monday (YYYY-MM-DD) of the week in `timeZone` (the server's, from /setup) containing `now`. */
export function weekStart(now: Date, timeZone: string): string {
  // en-CA formats a date as YYYY-MM-DD.
  const today = Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone }).format(now));
  const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  return new Date(today - daysSinceMonday * 86_400_000).toISOString().slice(0, 10);
}
