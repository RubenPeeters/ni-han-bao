// Wall-clock time in a server's time zone (set with /setup timezone), for "today", "this
// week" and the weekly report. Per-day counts are stored on the server's local days (in the
// zone set when they were counted); hourly counts stay UTC instants.

const DAY_MS = 24 * 60 * 60_000;
const formats = new Map<string, Intl.DateTimeFormat>();

function format(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    formats.set(timeZone, f);
  }
  return f;
}

/** The canonical IANA name for `name` (any case), or null when it is not a time zone. */
export function timeZoneName(name: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Wall-clock time in `timeZone` at `at`, as if it were UTC. */
export function wallClock(at: number, timeZone: string): number {
  const p = Object.fromEntries(format(timeZone).formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** UTC instant of a wall-clock time in `timeZone`. Only for times outside a DST gap. */
export function fromWallClock(wall: number, timeZone: string): number {
  const guess = wall - (wallClock(wall, timeZone) - wall);
  // The offset at the guess may differ from the one at `wall` near a DST switch; one more step settles it.
  return wall - (wallClock(guess, timeZone) - guess);
}

/** The day (YYYY-MM-DD) in `timeZone` at `at`. */
export function localDay(at: Date, timeZone: string): string {
  return new Date(wallClock(at.getTime(), timeZone)).toISOString().slice(0, 10);
}

/** Midnight in `timeZone` of the day containing `now`, as a UTC instant. */
export function dayStart(now: Date, timeZone: string): Date {
  return new Date(fromWallClock(Date.parse(localDay(now, timeZone)), timeZone));
}

/** Monday (YYYY-MM-DD) of the week in `timeZone` containing `now`. */
export function weekStart(now: Date, timeZone: string): string {
  const today = Date.parse(localDay(now, timeZone));
  const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  return new Date(today - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}
