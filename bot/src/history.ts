import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ActivityBuffer,
  shouldCount,
  utcHour,
  type ChannelCountRow,
  type ChannelRow,
  type CountRow,
  type MemberChannelCountRow,
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
 * The id that splits live counting from the backfill: the live bot counts messages at or
 * after it, the backfill those before it, so the two never overlap. Stored once per server
 * (backfill_state) by whichever of the two runs first.
 * With nothing counted yet it is now, so a server the bot just joined is counted from its
 * next message; the backfill adds the earlier part of that hour to the same rows.
 * A bot that counted before this boundary existed has no record of when it started: the
 * boundary is then the start of the first hour it counted (or of the first day, when member
 * counts are older than every channel count, from before channel counts existed).
 * shortcut: for such a bot, messages in its first counted hour from before it started are
 * never counted; only fixable had it recorded its first message id.
 */
export function backfillBefore(firstLiveDay: string | null, firstLiveHour: string | null, now: Date): string {
  const hour = firstLiveHour ? new Date(firstLiveHour) : null;
  if (firstLiveDay && (!hour || firstLiveDay < utcHour(hour).slice(0, 10))) {
    return snowflakeAt(new Date(`${firstLiveDay}T00:00:00.000Z`));
  }
  if (hour) return snowflakeAt(new Date(utcHour(hour)));
  return snowflakeAt(now);
}

/** Whether the live bot counts message `id`: older ones are the backfill's. */
export function countsLive(id: string, beforeId: string): boolean {
  return BigInt(id) >= BigInt(beforeId);
}

/** When `id` was created; the inverse of snowflakeAt. */
export function snowflakeTime(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
}

/**
 * The stored boundary (see backfillBefore), fixed on first call: once counts exist on both
 * sides of it, the counts no longer say where it was. With `store` false (a dry run) it is
 * computed but not stored.
 */
export async function loadBeforeId(db: SupabaseClient, guildId: string, store = true): Promise<string> {
  const state = () => db.from("backfill_state").select("before_id").eq("guild_id", guildId);
  const [stored] = must("backfill_state", await state());
  if (stored) return stored.before_id;
  const [firstDay] = must(
    "message_counts",
    await db.from("message_counts").select("day").eq("guild_id", guildId).order("day").limit(1),
  );
  const [firstHour] = must(
    "channel_message_counts",
    await db.from("channel_message_counts").select("hour").eq("guild_id", guildId).order("hour").limit(1),
  );
  const before_id = backfillBefore(firstDay?.day ?? null, firstHour?.hour ?? null, new Date());
  if (!store) return before_id;
  const { error } = await db.from("backfill_state").upsert({ guild_id: guildId, before_id }, { ignoreDuplicates: true });
  if (error) throw new Error(`backfill_state upsert: ${error.message}`);
  // Re-read: the other of live bot and backfill may have stored its boundary first.
  return must("backfill_state", await state())[0].before_id;
}

/** What backfill_state shows the site: channels done of total, and how far back it got. */
export function backfillProgress(cursors: Cursor[]) {
  const oldest = cursors.reduce<bigint | null>((min, c) => {
    const id = BigInt(c.beforeId);
    return min === null || id < min ? id : min;
  }, null);
  return {
    channels_total: cursors.length,
    channels_done: cursors.filter((c) => c.done).length,
    oldest_at: oldest === null ? null : snowflakeTime(oldest.toString()).toISOString(),
  };
}

/**
 * A server is done only when nothing failed, thread listing included, and every channel
 * reached its first message: a channel left early (a concurrent run moved its cursor) is not.
 */
export function backfillComplete(failures: number, cursors: Cursor[]): boolean {
  return failures === 0 && cursors.every((c) => c.done);
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
  memberChannelCounts: MemberChannelCountRow[];
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
    const { members, counts, channelCounts, memberChannelCounts } = buffer.drain();
    // Refused: the cursor moved under us (a concurrent run), so stop rather than race it.
    if (!(await io.writePage({ beforeId, nextBeforeId, done, members, counts, channelCounts, memberChannelCounts }))) break;
    total += counted;
    beforeId = nextBeforeId;
  }
  return total;
}
