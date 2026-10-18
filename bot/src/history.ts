import {
  ActivityBuffer,
  shouldCount,
  utcHour,
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
 * The id the backfill reads back from: the start of the first hour the live bot counted, or
 * of the current hour when it has counted nothing yet (it may be counting this hour already).
 * Live counts land at or after that hour, history counts before it, so the two never overlap.
 * Member counts older than every channel count (a bot from before channel counts existed)
 * move it back to the start of their day.
 * shortcut: messages in the first live hour from before the bot first started are never
 * counted; exact only if the live bot recorded its first message id, add that if it matters.
 */
export function backfillBefore(firstLiveDay: string | null, firstLiveHour: string | null, now: Date): string {
  const hour = firstLiveHour ? new Date(firstLiveHour) : null;
  if (firstLiveDay && (!hour || firstLiveDay < utcHour(hour).slice(0, 10))) {
    return snowflakeAt(new Date(`${firstLiveDay}T00:00:00.000Z`));
  }
  return snowflakeAt(new Date(utcHour(hour ?? now)));
}

export interface HistoryMessage extends MessageInfo {
  id: string;
  createdAt: Date;
  author: MemberRow;
}

export interface Cursor {
  /** Oldest message id already counted; only older messages are still to be read. */
  beforeId: string;
  done: boolean;
}

/** One page of counts plus the cursor move that must be applied with it, atomically. */
export interface Page {
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
 * Counts one channel's (or thread's) history from its cursor back to its first message,
 * into `channel` (a thread's parent). Each page is written together with the cursor that
 * skips it, so a crash or rerun resumes at the next page and never counts one twice.
 * Returns the messages counted.
 */
export async function backfillChannel(
  channel: ChannelRow,
  cursor: Cursor,
  guildId: string,
  io: HistoryIo,
  pageSize = HISTORY_PAGE_SIZE,
): Promise<number> {
  let { beforeId, done } = cursor;
  let total = 0;
  while (!done) {
    const messages = await io.fetchBefore(beforeId, pageSize);
    const nextBeforeId = messages.reduce((min, m) => (BigInt(m.id) < BigInt(min) ? m.id : min), beforeId);
    done = messages.length < pageSize;
    const buffer = new ActivityBuffer();
    let counted = 0;
    for (const m of messages) {
      if (!shouldCount(m, guildId)) continue;
      buffer.addMessage(m.author.user_id, channel.channel_id, m.createdAt);
      buffer.setMember(m.author);
      counted++;
    }
    const { members, counts, channelCounts } = buffer.drain();
    // Refused: the cursor moved under us (a concurrent run), so stop rather than race it.
    if (!(await io.writePage({ beforeId, nextBeforeId, done, members, counts, channelCounts }))) break;
    total += counted;
    beforeId = nextBeforeId;
  }
  return total;
}
