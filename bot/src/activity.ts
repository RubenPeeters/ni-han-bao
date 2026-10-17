import { randomUUID } from "node:crypto";

export interface MessageInfo {
  guildId: string | null;
  authorIsBot: boolean;
  webhookId: string | null;
  system: boolean;
}

/** Only real member messages in our guild count: no bots, webhooks or system notices. */
export function shouldCount(message: MessageInfo, guildId: string): boolean {
  return (
    message.guildId === guildId && !message.authorIsBot && !message.webhookId && !message.system
  );
}

/** UTC calendar day as YYYY-MM-DD (a Postgres `date` literal). */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface NameParts {
  nickname: string | null;
  globalName: string | null;
  username: string;
}

/** Server nickname, else global display name, else username. */
export function displayName({ nickname, globalName, username }: NameParts): string {
  return nickname || globalName || username;
}

export interface ProfileUser {
  id: string;
  username: string;
  globalName: string | null;
  displayAvatarURL(): string;
}

export interface ProfileMember {
  nickname: string | null;
  displayAvatarURL(): string;
}

/**
 * `member` can be missing on a message (e.g. uncached); fall back to the user so every
 * counted author still gets a members row, which message_counts references. A guild
 * member's avatar already falls back to the global one.
 */
export function memberRow(user: ProfileUser, member: ProfileMember | null): MemberRow {
  return {
    user_id: user.id,
    display_name: displayName({
      nickname: member?.nickname ?? null,
      globalName: user.globalName,
      username: user.username,
    }),
    avatar_url: (member ?? user).displayAvatarURL(),
  };
}

export interface MemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface CountRow {
  user_id: string;
  day: string;
  count: number;
}

/** Counts sent together under one id, so the database can drop a retry it already applied. */
export interface CountBatch {
  id: string;
  counts: CountRow[];
}

/**
 * Collects message counts and member snapshots in memory between flushes. Increments are
 * summed here and applied by the database in one statement, so bursts never race.
 */
export class ActivityBuffer {
  private counts = new Map<string, CountRow>();
  private members = new Map<string, MemberRow>();
  /**
   * A batch whose write failed: it may still have committed (e.g. the response was lost),
   * so it is resent unchanged under the same id rather than merged with newer counts.
   */
  pending: CountBatch | null = null;

  addMessage(userId: string, at: Date): void {
    const day = utcDay(at);
    const key = `${userId}:${day}`;
    const row = this.counts.get(key);
    if (row) row.count += 1;
    else this.counts.set(key, { user_id: userId, day, count: 1 });
  }

  /** Latest snapshot wins: a member is written once per flush however often they change. */
  setMember(member: MemberRow): void {
    this.members.set(member.user_id, member);
  }

  get isEmpty(): boolean {
    return this.counts.size === 0 && this.members.size === 0 && this.pending === null;
  }

  /** Take everything buffered so far, leaving the buffer empty for new events. */
  drain(): { members: MemberRow[]; counts: CountRow[] } {
    const drained = { members: [...this.members.values()], counts: [...this.counts.values()] };
    this.counts = new Map();
    this.members = new Map();
    return drained;
  }

  /**
   * Put back drained data that was never sent, so it goes out next flush. Counts are added
   * to anything that arrived meanwhile; members only fill gaps, since newer snapshots win.
   */
  restore({ members, counts }: { members: MemberRow[]; counts: CountRow[] }): void {
    for (const m of members) {
      if (!this.members.has(m.user_id)) this.members.set(m.user_id, m);
    }
    for (const c of counts) {
      const key = `${c.user_id}:${c.day}`;
      const row = this.counts.get(key);
      if (row) row.count += c.count;
      else this.counts.set(key, { ...c });
    }
  }
}

export interface ActivityWriter {
  upsertMembers(rows: MemberRow[]): Promise<void>;
  /** Must apply each batch id at most once, however often it is sent. */
  incrementCounts(batch: CountBatch): Promise<void>;
}

/**
 * Write everything buffered. Members and counts are drained together, so every count's
 * member is written before it (counts reference members). A pending batch goes before the
 * new one; whatever fails is kept for the next flush, so a database hiccup loses no
 * messages and, thanks to the batch id, double counts none either.
 */
export async function flushActivity(
  buffer: ActivityBuffer,
  writer: ActivityWriter,
  newBatchId: () => string = randomUUID,
): Promise<void> {
  if (buffer.isEmpty) return;
  const { members, counts } = buffer.drain();
  try {
    if (members.length) await writer.upsertMembers(members);
    if (buffer.pending) {
      await writer.incrementCounts(buffer.pending);
      buffer.pending = null;
    }
  } catch (err) {
    buffer.restore({ members, counts });
    throw err;
  }
  if (!counts.length) return;
  const batch = { id: newBatchId(), counts };
  try {
    await writer.incrementCounts(batch);
  } catch (err) {
    buffer.pending = batch;
    throw err;
  }
}
