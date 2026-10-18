import {
  ActivityBuffer,
  shouldCount,
  type ChannelCountRow,
  type ChannelRow,
  type CountRow,
  type MemberRow,
  type MessageInfo,
} from "./activity.js";

const DISCORD_EPOCH = 1420070400000n;
/** Discord's maximum for one history request. */
export const HISTORY_PAGE_SIZE = 100;

/** The smallest snowflake at `at`: every message sent earlier has a lower id. */
export function snowflakeAt(at: Date): string {
  return ((BigInt(at.getTime()) - DISCORD_EPOCH) << 22n).toString();
}

/**
 * Where the backfill stops: the start of the earliest hour the live bot counted, or of the
 * current hour when it has counted nothing yet. Live counts land in that hour's channel bucket
 * and its day's member bucket; history counts are added to the same buckets, and the message
 * ranges do not overlap. Falls back to the first live day when member counts are older than
 * any channel count (a bot from before channel counts existed).
 * shortcut: messages in the first live hour from before the bot started are not counted; its
 * exact start was never recorded, and an hour is the finest grain stored.
 */
export function backfillBoundary(firstLiveDay: string | null, firstLiveHour: string | null, now: Date): Date {
  if (firstLiveHour && (!firstLiveDay || firstLiveHour.slice(0, 10) <= firstLiveDay)) return new Date(firstLiveHour);
  if (firstLiveDay) return new Date(`${firstLiveDay}T00:00:00.000Z`);
  return new Date(`${now.toISOString().slice(0, 13)}:00:00.000Z`);
}

type Result<T> = { data: T | null; error: { message: string } | null };

/** For reads and RPCs: throws on a failed query; data is only null when there is an error. */
export function must<T>(what: string, r: Result<T>): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
}

/** For writes without `.select()`: those return data null on success. */
export function mustWrite(what: string, r: Result<unknown>): void {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}

export interface HistoryMessage extends MessageInfo {
  id: string;
  createdAt: Date;
  author: MemberRow;
}

export interface Cursor {
  /** The channel or thread being read; its counts go to the `channel` passed alongside. */
  channelId: string;
  beforeId: string;
  done: boolean;
}

/** One page of counts plus the cursor move that must be applied with it, atomically. */
export interface Page {
  channelId: string;
  beforeId: string;
  nextBeforeId: string;
  done: boolean;
  members: MemberRow[];
  counts: CountRow[];
  channelCounts: ChannelCountRow[];
}

export interface HistoryIo {
  /** Up to `limit` messages older than `beforeId`, in any order. */
  fetchBefore(beforeId: string, limit: number): Promise<HistoryMessage[]>;
  /** Applies the page only if the stored cursor is still `page.beforeId`; returns whether it did. */
  writePage(page: Page): Promise<boolean>;
}

/**
 * Counts one channel's history from its cursor back to the channel's first message. Each
 * page is written together with the cursor that skips it, so a crash or rerun resumes at the
 * next page and never counts one twice. Returns the messages counted.
 */
export async function backfillChannel(
  channel: ChannelRow,
  cursor: Cursor,
  guildId: string,
  io: HistoryIo,
  pageSize = HISTORY_PAGE_SIZE,
): Promise<number> {
  let { beforeId, done } = cursor;
  let counted = 0;
  while (!done) {
    const messages = await io.fetchBefore(beforeId, pageSize);
    const nextBeforeId = messages.reduce(
      (min, m) => (BigInt(m.id) < BigInt(min) ? m.id : min),
      beforeId,
    );
    done = messages.length < pageSize;
    const buffer = new ActivityBuffer();
    let pageCounted = 0;
    for (const m of messages) {
      if (!shouldCount(m, guildId)) continue;
      buffer.addMessage(m.author.user_id, channel.channel_id, m.createdAt);
      buffer.setMember(m.author);
      pageCounted++;
    }
    const { members, counts, channelCounts } = buffer.drain();
    const page = { channelId: cursor.channelId, beforeId, nextBeforeId, done, members, counts, channelCounts };
    // Someone else moved the cursor (a concurrent run): stop rather than race it.
    if (!(await io.writePage(page))) break;
    counted += pageCounted;
    beforeId = nextBeforeId;
  }
  return counted;
}
