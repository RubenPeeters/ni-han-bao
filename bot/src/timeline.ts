import { randomUUID } from "node:crypto";
import type { MemberRow } from "./activity.js";
import { fromWallClock, localDay } from "./zone.js";

const DAY_MS = 24 * 60 * 60_000;

export interface VoiceSecondsRow {
  user_id: string;
  day: string;
  seconds: number;
}

/**
 * Split `[from, to)` (whole seconds since the epoch) at midnights in `timeZone`, so time spent
 * in voice across midnight lands on both days.
 */
export function splitByDay(userId: string, from: number, to: number, timeZone: string): VoiceSecondsRow[] {
  const rows: VoiceSecondsRow[] = [];
  let start = from;
  while (start < to) {
    const day = localDay(new Date(start * 1000), timeZone);
    const midnight = fromWallClock(Date.parse(day) + DAY_MS, timeZone) / 1000;
    // shortcut: a zone whose clocks skip midnight (DST gap) splits a second at a time until the gap ends; rare and still exact.
    const end = Math.min(to, Math.max(start + 1, midnight));
    rows.push({ user_id: userId, day, seconds: end - start });
    start = end;
  }
  return rows;
}

/** Whole seconds: midnights fall on whole seconds, and the database stores whole seconds. */
function toSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/**
 * Who is in voice right now, in memory only. Each open session remembers up to when its
 * time has been counted; `collect` counts the rest and moves that mark forward. Nothing
 * open is ever written, so a session the bot never saw end (crash, restart) cannot be
 * counted forever: at most the time since the last `collect` is lost, and after a
 * restart `sync` reopens sessions from what Discord says is in voice now.
 */
export class VoiceSessions {
  private open = new Map<string, number>();

  /** `timeZone`: the server's, as in ActivityBuffer. */
  constructor(private readonly timeZone: () => string = () => "UTC") {}

  get size(): number {
    return this.open.size;
  }

  /**
   * Apply one voice state change. Moving between voice channels keeps the session open:
   * the time counted is time in voice, whichever channel. Returns the time a leave closed.
   */
  update(userId: string, inVoice: boolean, at: Date): VoiceSecondsRow[] {
    if (inVoice) {
      if (!this.open.has(userId)) this.open.set(userId, toSeconds(at));
      return [];
    }
    const rows = this.counted(userId, at);
    this.open.delete(userId);
    return rows;
  }

  /**
   * Match the sessions to everyone Discord says is in voice: close sessions of members
   * who left while we were not looking, open sessions for those who joined.
   */
  sync(inVoice: Iterable<string>, at: Date): VoiceSecondsRow[] {
    const present = new Set(inVoice);
    const rows: VoiceSecondsRow[] = [];
    for (const userId of [...this.open.keys()]) {
      if (!present.has(userId)) rows.push(...this.update(userId, false, at));
    }
    for (const userId of present) this.update(userId, true, at);
    return rows;
  }

  /** Time spent so far in every open session, which stay open. */
  collect(at: Date): VoiceSecondsRow[] {
    return [...this.open.keys()].flatMap((userId) => this.counted(userId, at));
  }

  /** Close every session, e.g. on shutdown. */
  closeAll(at: Date): VoiceSecondsRow[] {
    return this.sync([], at);
  }

  private counted(userId: string, at: Date): VoiceSecondsRow[] {
    const from = this.open.get(userId);
    if (from === undefined) return [];
    const to = toSeconds(at);
    // A clock that went backwards counts nothing rather than negative time.
    if (to <= from) return [];
    this.open.set(userId, to);
    return splitByDay(userId, from, to, this.timeZone());
  }
}

export interface FlowRow {
  day: string;
  joins: number;
  leaves: number;
}

/** Sent together under one id, so the database can drop a retry it already applied. */
export interface TimelineBatch {
  id: string;
  flow: FlowRow[];
  voice: VoiceSecondsRow[];
}

export interface DrainedTimeline {
  members: MemberRow[];
  flow: FlowRow[];
  voice: VoiceSecondsRow[];
}

/** Joins, leaves and voice time between flushes, the same way ActivityBuffer holds messages. */
export class TimelineBuffer {
  private members = new Map<string, MemberRow>();
  private flow = new Map<string, FlowRow>();
  private voice = new Map<string, VoiceSecondsRow>();
  /** A batch whose write failed; resent unchanged under the same id, as in ActivityBuffer. */
  pending: TimelineBatch | null = null;

  /** `timeZone`: the server's, as in ActivityBuffer. */
  constructor(private readonly timeZone: () => string = () => "UTC") {}

  addJoin(at: Date): void {
    this.addFlow({ day: localDay(at, this.timeZone()), joins: 1, leaves: 0 });
  }

  addLeave(at: Date): void {
    this.addFlow({ day: localDay(at, this.timeZone()), joins: 0, leaves: 1 });
  }

  /** Written before any voice time, which references it. Latest snapshot wins. */
  setMember(member: MemberRow): void {
    this.members.set(member.user_id, member);
  }

  addVoice(rows: VoiceSecondsRow[]): void {
    for (const r of rows) {
      const key = `${r.user_id}:${r.day}`;
      const row = this.voice.get(key);
      if (row) row.seconds += r.seconds;
      else this.voice.set(key, { ...r });
    }
  }

  private addFlow(f: FlowRow): void {
    const row = this.flow.get(f.day);
    if (row) {
      row.joins += f.joins;
      row.leaves += f.leaves;
    } else {
      this.flow.set(f.day, { ...f });
    }
  }

  get isEmpty(): boolean {
    return (
      this.members.size === 0 &&
      this.flow.size === 0 &&
      this.voice.size === 0 &&
      this.pending === null
    );
  }

  drain(): DrainedTimeline {
    const drained = {
      members: [...this.members.values()],
      flow: [...this.flow.values()],
      voice: [...this.voice.values()],
    };
    this.members = new Map();
    this.flow = new Map();
    this.voice = new Map();
    return drained;
  }

  /** Put back drained data that was never sent; newer snapshots win, counts add up. */
  restore({ members, flow, voice }: DrainedTimeline): void {
    for (const m of members) {
      if (!this.members.has(m.user_id)) this.members.set(m.user_id, m);
    }
    for (const f of flow) this.addFlow(f);
    this.addVoice(voice);
  }
}

export interface TimelineWriter {
  upsertMembers(rows: MemberRow[]): Promise<void>;
  /** Must apply each batch id at most once, however often it is sent. */
  incrementTimeline(batch: TimelineBatch): Promise<void>;
}

/** Same contract as flushActivity: nothing is lost on failure and nothing counted twice. */
export async function flushTimeline(
  buffer: TimelineBuffer,
  writer: TimelineWriter,
  newBatchId: () => string = randomUUID,
): Promise<void> {
  if (buffer.isEmpty) return;
  const drained = buffer.drain();
  const { members, flow, voice } = drained;
  try {
    if (members.length) await writer.upsertMembers(members);
    if (buffer.pending) {
      await writer.incrementTimeline(buffer.pending);
      buffer.pending = null;
    }
  } catch (err) {
    buffer.restore(drained);
    throw err;
  }
  if (!flow.length && !voice.length) return;
  const batch = { id: newBatchId(), flow, voice };
  try {
    await writer.incrementTimeline(batch);
  } catch (err) {
    buffer.pending = batch;
    throw err;
  }
}
