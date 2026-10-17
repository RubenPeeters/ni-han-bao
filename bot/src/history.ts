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
export const PAGE_SIZE = 100;

/** The smallest snowflake at `at`: every message sent earlier has a lower id. */
export function snowflakeAt(at: Date): string {
  return ((BigInt(at.getTime()) - DISCORD_EPOCH) << 22n).toString();
}

/**
 * Where the backfill stops: the start of a UTC day that ended at least an hour ago. The live
 * bot only flushes a few seconds behind, so it never adds to a bucket before this again,
 * which is what lets backfill_apply() take the larger of the live and history counts.
 */
export function backfillCutoff(now: Date): Date {
  return new Date(`${new Date(now.getTime() - 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
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
  pageSize = PAGE_SIZE,
): Promise<number> {
  let { channelId, beforeId, done } = cursor;
  let counted = 0;
  while (!done) {
    const page = await io.fetchBefore(beforeId, pageSize);
    const nextBeforeId = page.reduce((min, m) => (BigInt(m.id) < BigInt(min) ? m.id : min), beforeId);
    done = page.length < pageSize;
    const buffer = new ActivityBuffer();
    let pageCounted = 0;
    for (const m of page) {
      if (!shouldCount(m, guildId)) continue;
      buffer.addMessage(m.author.user_id, channel.channel_id, m.createdAt);
      buffer.setMember(m.author);
      pageCounted++;
    }
    const { members, counts, channelCounts } = buffer.drain();
    const applied = await io.writePage({
      channelId,
      beforeId,
      nextBeforeId,
      done,
      members,
      counts,
      channelCounts,
    });
    // Someone else moved the cursor (a concurrent run): stop rather than race it.
    if (!applied) break;
    counted += pageCounted;
    beforeId = nextBeforeId;
  }
  return counted;
}
