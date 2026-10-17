import { utcDay } from "./activity.js";

export interface VoiceSecondsRow {
  user_id: string;
  day: string;
  seconds: number;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Seconds in [start, end) per UTC day. Seconds are counted as whole-second boundaries
 * crossed, so cutting one stretch into many pieces (every flush, every midnight) sums to
 * exactly what counting it in one go would, with no rounding drift.
 */
export function splitByUtcDay(userId: string, start: Date, end: Date): VoiceSecondsRow[] {
  const rows: VoiceSecondsRow[] = [];
  let from = start.getTime();
  const to = end.getTime();
  while (from < to) {
    const midnight = (Math.floor(from / DAY_MS) + 1) * DAY_MS;
    const until = Math.min(midnight, to);
    const seconds = Math.floor(until / 1000) - Math.floor(from / 1000);
    if (seconds > 0) rows.push({ user_id: userId, day: utcDay(new Date(from)), seconds });
    from = until;
  }
  return rows;
}

/**
 * Open voice sessions, in memory only. A session holds the start of the stretch not yet
 * counted; counting moves it forward. Nothing open is ever persisted, so a crash or restart
 * loses at most the stretch since the last count and never counts the downtime.
 */
export class VoiceTracker {
  private open = new Map<string, Date>();

  isOpen(userId: string): boolean {
    return this.open.has(userId);
  }

  /**
   * A member's voice channel changed; null means out of (counted) voice. Moving between
   * channels keeps the session going, so a move is neither a leave nor a join.
   */
  update(userId: string, channelId: string | null, at: Date): VoiceSecondsRow[] {
    const start = this.open.get(userId);
    if (channelId === null) {
      this.open.delete(userId);
      return start ? splitByUtcDay(userId, start, at) : [];
    }
    if (!start) this.open.set(userId, at);
    return [];
  }

  /** Count every open session up to `at`, keeping them open. */
  accrue(at: Date): VoiceSecondsRow[] {
    const rows: VoiceSecondsRow[] = [];
    for (const [userId, start] of this.open) {
      // A clock step backwards must not count negative time or move the start back.
      if (at <= start) continue;
      rows.push(...splitByUtcDay(userId, start, at));
      this.open.set(userId, at);
    }
    return rows;
  }

  /**
   * Make the open sessions match who is in voice right now, counting up to `at`. Covers
   * startup (people already in voice start counting now) and any leave whose event was
   * missed, so no session stays open forever.
   */
  sync(inVoice: Iterable<string>, at: Date): VoiceSecondsRow[] {
    const present = new Set(inVoice);
    const rows: VoiceSecondsRow[] = [];
    for (const userId of [...this.open.keys()]) {
      if (!present.has(userId)) rows.push(...this.update(userId, null, at));
    }
    rows.push(...this.accrue(at));
    for (const userId of present) {
      if (!this.open.has(userId)) this.open.set(userId, at);
    }
    return rows;
  }

  /** Count and close every session, for shutdown. */
  closeAll(at: Date): VoiceSecondsRow[] {
    return this.sync([], at);
  }
}
