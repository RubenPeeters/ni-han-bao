export interface MessageInfo {
  guildId: string | null;
  authorIsBot: boolean;
  webhookId: string | null;
  system: boolean;
}

/** Only human messages in the configured guild count towards the leaderboard. */
export function shouldCount(msg: MessageInfo, guildId: string): boolean {
  return msg.guildId === guildId && !msg.authorIsBot && msg.webhookId === null && !msg.system;
}

export interface NameParts {
  nickname: string | null;
  globalName: string | null;
  username: string;
}

export function displayName({ nickname, globalName, username }: NameParts): string {
  return nickname || globalName || username;
}

/** The UTC calendar day as `YYYY-MM-DD`, matching a Postgres `date`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
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

export interface Batch {
  members: MemberRow[];
  counts: CountRow[];
}

/**
 * Buffers activity in memory so a burst of messages becomes one aggregated write per flush.
 * Single-threaded JS makes the in-memory increments race-free; the database adds the
 * drained totals atomically.
 */
export class ActivityBuffer {
  private members = new Map<string, MemberRow>();
  private counts = new Map<string, CountRow>();

  /** Remember the latest profile; later calls win, so names and avatars stay current. */
  member(row: MemberRow): void {
    this.members.set(row.user_id, row);
  }

  message(userId: string, at: Date, count = 1): void {
    const day = utcDay(at);
    const key = `${userId}|${day}`;
    const row = this.counts.get(key);
    if (row) row.count += count;
    else this.counts.set(key, { user_id: userId, day, count });
  }

  /** Take everything buffered so far, leaving the buffer empty. */
  drain(): Batch {
    const batch = { members: [...this.members.values()], counts: [...this.counts.values()] };
    this.members.clear();
    this.counts.clear();
    return batch;
  }

  /** Put back a batch whose write failed, without overwriting newer profiles. */
  restore(batch: Batch): void {
    for (const row of batch.members) {
      if (!this.members.has(row.user_id)) this.members.set(row.user_id, row);
    }
    for (const row of batch.counts) this.message(row.user_id, new Date(`${row.day}T00:00:00Z`), row.count);
  }

  get isEmpty(): boolean {
    return this.members.size === 0 && this.counts.size === 0;
  }
}
