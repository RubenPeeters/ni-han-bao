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

/**
 * Collects message counts and member snapshots in memory between flushes. Increments are
 * summed here and applied by the database in one statement, so bursts never race.
 */
export class ActivityBuffer {
  private counts = new Map<string, CountRow>();
  private members = new Map<string, MemberRow>();

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
    return this.counts.size === 0 && this.members.size === 0;
  }

  /** Take everything buffered so far, leaving the buffer empty for new events. */
  drain(): { members: MemberRow[]; counts: CountRow[] } {
    const drained = { members: [...this.members.values()], counts: [...this.counts.values()] };
    this.counts = new Map();
    this.members = new Map();
    return drained;
  }

  /**
   * Put back a batch whose write failed so it is retried next flush. Counts are added to
   * anything that arrived meanwhile; members only fill gaps, since newer snapshots win.
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
  incrementCounts(rows: CountRow[]): Promise<void>;
}

/**
 * Write one drained batch. Members go first because counts reference them; whatever fails
 * is restored into the buffer for the next flush, so a database hiccup loses no messages.
 */
export async function flushActivity(buffer: ActivityBuffer, writer: ActivityWriter): Promise<void> {
  if (buffer.isEmpty) return;
  const { members, counts } = buffer.drain();
  try {
    if (members.length) await writer.upsertMembers(members);
  } catch (err) {
    buffer.restore({ members, counts });
    throw err;
  }
  try {
    if (counts.length) await writer.incrementCounts(counts);
  } catch (err) {
    buffer.restore({ members: [], counts });
    throw err;
  }
}
