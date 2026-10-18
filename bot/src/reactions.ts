import { randomUUID } from "node:crypto";
import { shouldCount, type MemberRow, type MessageInfo } from "./activity.js";
import { localDay } from "./zone.js";

export interface EmojiInfo {
  id: string | null;
  name: string | null;
  animated: boolean | null;
}

export interface EmojiRow {
  emoji_key: string;
  /** Set for custom emoji only; the site builds the CDN image URL from it. */
  emoji_id: string | null;
  /** Null for a custom emoji Discord no longer sends a name for (e.g. deleted). */
  name: string | null;
  animated: boolean;
}

/**
 * One key per emoji: a custom emoji's id, so a rename keeps its counts, or else the unicode
 * emoji itself. The two cannot collide, since ids are all ASCII digits and no unicode emoji
 * is. Null when Discord sent neither.
 */
export function emojiRow({ id, name, animated }: EmojiInfo): EmojiRow | null {
  if (id) return { emoji_key: id, emoji_id: id, name, animated: animated ?? false };
  if (name) return { emoji_key: name, emoji_id: null, name, animated: false };
  return null;
}

/**
 * Whether a reaction counts toward its message author's "received" total: the author must
 * be a member whose messages count (no bots, webhooks or system notices), and reacting to
 * your own message does not count.
 */
export function receivesReaction(
  author: MessageInfo & { id: string },
  reactorId: string,
  guildId: string,
): boolean {
  return shouldCount(author, guildId) && author.id !== reactorId;
}

export interface EmojiCountRow {
  emoji_key: string;
  day: string;
  count: number;
}

export interface MemberEmojiCountRow {
  user_id: string;
  emoji_key: string;
  day: string;
  count: number;
}

export interface ReceivedCountRow {
  user_id: string;
  day: string;
  count: number;
}

/** Sent together under one id, so the database can drop a retry it already applied. */
export interface ReactionBatch {
  id: string;
  emojis: EmojiRow[];
  emojiCounts: EmojiCountRow[];
  receivedCounts: ReceivedCountRow[];
  memberEmojiCounts: MemberEmojiCountRow[];
}

export interface DrainedReactions {
  members: MemberRow[];
  emojis: EmojiRow[];
  emojiCounts: EmojiCountRow[];
  receivedCounts: ReceivedCountRow[];
  memberEmojiCounts: MemberEmojiCountRow[];
}

/**
 * Reactions between flushes, the same way ActivityBuffer holds messages. Only additions
 * are counted; removals are ignored, so a count means "times this was reacted", and a
 * reaction added before the bot was running can never push a count below zero.
 */
export class ReactionBuffer {
  private members = new Map<string, MemberRow>();
  private emojis = new Map<string, EmojiRow>();
  private emojiCounts = new Map<string, EmojiCountRow>();
  private receivedCounts = new Map<string, ReceivedCountRow>();
  private memberEmojiCounts = new Map<string, MemberEmojiCountRow>();
  /** A batch whose write failed; resent unchanged under the same id, as in ActivityBuffer. */
  pending: ReactionBatch | null = null;

  /** `timeZone`: the server's, as in ActivityBuffer. */
  constructor(private readonly timeZone: () => string = () => "UTC") {}

  /** `reactor` (null when not a known member) is written before the count, which references it. */
  addEmoji(emoji: EmojiRow, at: Date, reactor: MemberRow | null): void {
    this.emojis.set(emoji.emoji_key, emoji);
    this.addEmojiCount({ emoji_key: emoji.emoji_key, day: localDay(at, this.timeZone()), count: 1 });
    if (!reactor) return;
    this.members.set(reactor.user_id, reactor);
    this.addMemberEmojiCount({ user_id: reactor.user_id, emoji_key: emoji.emoji_key, day: localDay(at, this.timeZone()), count: 1 });
  }

  /** `author` is written before the count, which references it. */
  addReceived(author: MemberRow, at: Date): void {
    this.members.set(author.user_id, author);
    this.addReceivedCount({ user_id: author.user_id, day: localDay(at, this.timeZone()), count: 1 });
  }

  private addEmojiCount(c: EmojiCountRow): void {
    const key = `${c.emoji_key}:${c.day}`;
    const row = this.emojiCounts.get(key);
    if (row) row.count += c.count;
    else this.emojiCounts.set(key, { ...c });
  }

  private addMemberEmojiCount(c: MemberEmojiCountRow): void {
    const key = `${c.user_id}:${c.emoji_key}:${c.day}`;
    const row = this.memberEmojiCounts.get(key);
    if (row) row.count += c.count;
    else this.memberEmojiCounts.set(key, { ...c });
  }

  private addReceivedCount(c: ReceivedCountRow): void {
    const key = `${c.user_id}:${c.day}`;
    const row = this.receivedCounts.get(key);
    if (row) row.count += c.count;
    else this.receivedCounts.set(key, { ...c });
  }

  get isEmpty(): boolean {
    return (
      this.members.size === 0 &&
      this.emojis.size === 0 &&
      this.emojiCounts.size === 0 &&
      this.receivedCounts.size === 0 &&
      this.memberEmojiCounts.size === 0 &&
      this.pending === null
    );
  }

  drain(): DrainedReactions {
    const drained = {
      members: [...this.members.values()],
      emojis: [...this.emojis.values()],
      emojiCounts: [...this.emojiCounts.values()],
      receivedCounts: [...this.receivedCounts.values()],
      memberEmojiCounts: [...this.memberEmojiCounts.values()],
    };
    this.members = new Map();
    this.emojis = new Map();
    this.emojiCounts = new Map();
    this.receivedCounts = new Map();
    this.memberEmojiCounts = new Map();
    return drained;
  }

  /** Put back drained data that was never sent; newer snapshots win, counts add up. */
  restore({ members, emojis, emojiCounts, receivedCounts, memberEmojiCounts }: DrainedReactions): void {
    for (const m of members) {
      if (!this.members.has(m.user_id)) this.members.set(m.user_id, m);
    }
    for (const e of emojis) {
      if (!this.emojis.has(e.emoji_key)) this.emojis.set(e.emoji_key, e);
    }
    for (const c of emojiCounts) this.addEmojiCount(c);
    for (const c of receivedCounts) this.addReceivedCount(c);
    for (const c of memberEmojiCounts) this.addMemberEmojiCount(c);
  }
}

export interface ReactionWriter {
  upsertMembers(rows: MemberRow[]): Promise<void>;
  /** Must apply each batch id at most once, however often it is sent. */
  incrementReactions(batch: ReactionBatch): Promise<void>;
}

/** Same contract as flushActivity: nothing is lost on failure and nothing counted twice. */
export async function flushReactions(
  buffer: ReactionBuffer,
  writer: ReactionWriter,
  newBatchId: () => string = randomUUID,
): Promise<void> {
  if (buffer.isEmpty) return;
  const drained = buffer.drain();
  const { members, emojis, emojiCounts, receivedCounts, memberEmojiCounts } = drained;
  try {
    if (members.length) await writer.upsertMembers(members);
    if (buffer.pending) {
      await writer.incrementReactions(buffer.pending);
      buffer.pending = null;
    }
  } catch (err) {
    buffer.restore(drained);
    throw err;
  }
  if (!emojiCounts.length && !receivedCounts.length) return;
  // Every reaction adds to emojiCounts, so memberEmojiCounts is empty whenever it is.
  const batch = { id: newBatchId(), emojis, emojiCounts, receivedCounts, memberEmojiCounts };
  try {
    await writer.incrementReactions(batch);
  } catch (err) {
    buffer.pending = batch;
    throw err;
  }
}
