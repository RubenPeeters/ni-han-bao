import { randomUUID } from "node:crypto";
import { splitByDay } from "./timeline.js";

/** Discord's ActivityType values we count; Listening (Spotify), Watching and Custom are not. */
const KINDS: Record<number, GameKind> = { 0: "playing", 1: "streaming", 5: "competing" };
export type GameKind = "playing" | "streaming" | "competing";

/** Twelve hours: a session open longer is one the bot missed the end of. */
export const MAX_SESSION_S = 12 * 60 * 60;
const MAX_NAME = 128;

export interface GameSecondsRow {
  user_id: string;
  day: string;
  kind: GameKind;
  name: string;
  seconds: number;
  /** The session was still open when counted; drives "playing now" on the site. */
  live: boolean;
}

/**
 * The keys of the activities we count, from a presence's activity list. Only the type and
 * name are read: no details, state or rich presence ever leave this function.
 */
export function gameKeys(activities: readonly { type: number; name: string }[]): string[] {
  const keys = new Set<string>();
  for (const { type, name } of activities) {
    const kind = KINDS[type];
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (kind && trimmed) keys.add(`${kind}:${trimmed}`);
  }
  return [...keys];
}

const toSeconds = (at: Date) => Math.floor(at.getTime() / 1000);

interface Session {
  userId: string;
  kind: GameKind;
  name: string;
  started: number;
  counted: number;
}

/**
 * Who is playing or streaming what, in memory only, the way VoiceSessions tracks voice.
 * Keyed by user, not by server: the same presence arrives once per shared server and is
 * counted once. Days are UTC.
 */
export class GameSessions {
  private open = new Map<string, Session>();

  get size(): number {
    return this.open.size;
  }

  /** Apply a user's current activities (empty when offline); returns the time closed sessions add. */
  update(userId: string, keys: readonly string[], at: Date): GameSecondsRow[] {
    const now = new Set(keys);
    const rows: GameSecondsRow[] = [];
    for (const [id, s] of this.open) {
      if (s.userId === userId && !now.has(id.slice(userId.length + 1))) rows.push(...this.close(id, at));
    }
    for (const key of now) {
      const id = `${userId}:${key}`;
      if (this.open.has(id)) continue;
      const split = key.indexOf(":");
      const t = toSeconds(at);
      this.open.set(id, {
        userId,
        kind: key.slice(0, split) as GameKind,
        name: key.slice(split + 1),
        started: t,
        counted: t,
      });
    }
    return rows;
  }

  /** Time so far in every open session; sessions past MAX_SESSION_S close at their cap. */
  collect(at: Date): GameSecondsRow[] {
    return [...this.open.keys()].flatMap((id) => this.counted(id, at));
  }

  /** Ends the sessions of users `keep` rejects: they no longer share a server, so no presence will end them. */
  closeUnless(keep: (userId: string) => boolean, at: Date): GameSecondsRow[] {
    return [...this.open].filter(([, s]) => !keep(s.userId)).flatMap(([id]) => this.close(id, at));
  }

  /** Forgets a user's open sessions without counting them (/hide-me, /show-me). */
  drop(userId: string): void {
    for (const [id, s] of this.open) if (s.userId === userId) this.open.delete(id);
  }

  closeAll(at: Date): GameSecondsRow[] {
    return [...this.open.keys()].flatMap((id) => this.close(id, at));
  }

  private close(id: string, at: Date): GameSecondsRow[] {
    const rows = this.counted(id, at).map((r) => ({ ...r, live: false }));
    this.open.delete(id);
    return rows;
  }

  private counted(id: string, at: Date): GameSecondsRow[] {
    const s = this.open.get(id);
    if (!s) return [];
    const cap = s.started + MAX_SESSION_S;
    const capped = toSeconds(at) >= cap;
    const to = Math.min(toSeconds(at), cap);
    if (capped) this.open.delete(id);
    // A clock that went backwards counts nothing rather than negative time.
    if (to <= s.counted) return [];
    const from = s.counted;
    s.counted = to;
    return splitByDay(s.userId, from, to, "UTC").map((r) => ({ ...r, kind: s.kind, name: s.name, live: !capped }));
  }
}

/** Sent under one id, so the database can drop a retry it already applied. */
export interface GameBatch {
  id: string;
  games: GameSecondsRow[];
}

/** Game time between flushes; seconds add up, the latest open/closed state wins. */
export class GameBuffer {
  private rows = new Map<string, GameSecondsRow>();
  /** A batch whose write failed, resent unchanged under the same id before anything newer. */
  pending: GameBatch | null = null;

  add(rows: GameSecondsRow[]): void {
    for (const r of rows) {
      const key = `${r.user_id}:${r.day}:${r.kind}:${r.name}`;
      const row = this.rows.get(key);
      if (row) {
        row.seconds += r.seconds;
        row.live = r.live;
      } else {
        this.rows.set(key, { ...r });
      }
    }
  }

  /** Buffered rows plus the failed batch, for the log. */
  get seconds(): number {
    return [...this.rows.values(), ...(this.pending?.games ?? [])].reduce((n, r) => n + r.seconds, 0);
  }

  /** Forgets a user's unwritten time, the failed batch's too: it must not be written after /show-me. */
  drop(userId: string): void {
    for (const [key, r] of this.rows) if (r.user_id === userId) this.rows.delete(key);
    if (this.pending) this.pending.games = this.pending.games.filter((r) => r.user_id !== userId);
  }

  drain(): GameSecondsRow[] {
    const rows = [...this.rows.values()];
    this.rows = new Map();
    return rows;
  }
}

export interface GameWriter {
  /** Must apply each batch id at most once, however often it is sent. */
  incrementGames(batch: GameBatch): Promise<void>;
}

/** Same contract as flushTimeline: nothing is lost on failure and nothing counted twice. */
export async function flushGames(
  buffer: GameBuffer,
  writer: GameWriter,
  newBatchId: () => string = randomUUID,
): Promise<void> {
  if (buffer.pending) {
    await writer.incrementGames(buffer.pending);
    buffer.pending = null;
  }
  const games = buffer.drain();
  if (!games.length) return;
  const batch = { id: newBatchId(), games };
  try {
    await writer.incrementGames(batch);
  } catch (err) {
    buffer.pending = batch;
    throw err;
  }
}
