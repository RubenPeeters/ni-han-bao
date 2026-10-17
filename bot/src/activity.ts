import { randomUUID } from "node:crypto";
import type { VoiceSecondsRow } from "./voice.js";

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

/** Start of the UTC hour as an ISO timestamp (a Postgres `timestamptz` literal). */
export function utcHour(at: Date): string {
  return `${at.toISOString().slice(0, 13)}:00:00.000Z`;
}

export interface ChannelInfo {
  id: string;
  name: string;
  /**
   * The channel a thread lives in; null when uncached. Leave unset for other channels:
   * their discord.js `parent` is a category, which must not take their messages.
   */
  parent?: { id: string; name: string } | null;
}

/**
 * Threads come and go, so their messages count toward the channel they live in. A thread
 * whose parent is unknown counts as itself rather than being dropped.
 */
export function channelRow(channel: ChannelInfo): ChannelRow {
  const target = channel.parent ?? channel;
  return { channel_id: target.id, name: target.name };
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

export interface ChannelRow {
  channel_id: string;
  name: string;
}

export interface ChannelCountRow {
  channel_id: string;
  hour: string;
  count: number;
}

/** Joins and leaves of the server on one UTC day. */
export interface MemberFlowRow {
  day: string;
  joins: number;
  leaves: number;
}

/** Counts sent together under one id, so the database can drop a retry it already applied. */
export interface CountBatch {
  id: string;
  counts: CountRow[];
  channelCounts: ChannelCountRow[];
  voiceSeconds: VoiceSecondsRow[];
  memberFlow: MemberFlowRow[];
}

export interface Drained {
  members: MemberRow[];
  channels: ChannelRow[];
  counts: CountRow[];
  channelCounts: ChannelCountRow[];
  voiceSeconds: VoiceSecondsRow[];
  memberFlow: MemberFlowRow[];
}

/**
 * Collects message counts and member snapshots in memory between flushes. Increments are
 * summed here and applied by the database in one statement, so bursts never race.
 */
export class ActivityBuffer {
  private counts = new Map<string, CountRow>();
  private channelCounts = new Map<string, ChannelCountRow>();
  private voiceSeconds = new Map<string, VoiceSecondsRow>();
  private memberFlow = new Map<string, MemberFlowRow>();
  private members = new Map<string, MemberRow>();
  private channels = new Map<string, ChannelRow>();
  /**
   * A batch whose write failed: it may still have committed (e.g. the response was lost),
   * so it is resent unchanged under the same id rather than merged with newer counts.
   */
  pending: CountBatch | null = null;

  addMessage(userId: string, channelId: string, at: Date): void {
    this.addCount({ user_id: userId, day: utcDay(at), count: 1 });
    this.addChannelCount({ channel_id: channelId, hour: utcHour(at), count: 1 });
  }

  private addCount(c: CountRow): void {
    const key = `${c.user_id}:${c.day}`;
    const row = this.counts.get(key);
    if (row) row.count += c.count;
    else this.counts.set(key, { ...c });
  }

  private addChannelCount(c: ChannelCountRow): void {
    const key = `${c.channel_id}:${c.hour}`;
    const row = this.channelCounts.get(key);
    if (row) row.count += c.count;
    else this.channelCounts.set(key, { ...c });
  }

  addVoice(v: VoiceSecondsRow): void {
    const key = `${v.user_id}:${v.day}`;
    const row = this.voiceSeconds.get(key);
    if (row) row.seconds += v.seconds;
    else this.voiceSeconds.set(key, { ...v });
  }

  addJoin(at: Date): void {
    this.addFlow({ day: utcDay(at), joins: 1, leaves: 0 });
  }

  addLeave(at: Date): void {
    this.addFlow({ day: utcDay(at), joins: 0, leaves: 1 });
  }

  private addFlow(f: MemberFlowRow): void {
    const row = this.memberFlow.get(f.day);
    if (row) {
      row.joins += f.joins;
      row.leaves += f.leaves;
    } else this.memberFlow.set(f.day, { ...f });
  }

  /** Latest snapshot wins: a member is written once per flush however often they change. */
  setMember(member: MemberRow): void {
    this.members.set(member.user_id, member);
  }

  /** Latest name wins, like members. */
  setChannel(channel: ChannelRow): void {
    this.channels.set(channel.channel_id, channel);
  }

  get isEmpty(): boolean {
    return (
      this.counts.size === 0 &&
      this.channelCounts.size === 0 &&
      this.voiceSeconds.size === 0 &&
      this.memberFlow.size === 0 &&
      this.members.size === 0 &&
      this.channels.size === 0 &&
      this.pending === null
    );
  }

  /** Take everything buffered so far, leaving the buffer empty for new events. */
  drain(): Drained {
    const drained = {
      members: [...this.members.values()],
      channels: [...this.channels.values()],
      counts: [...this.counts.values()],
      channelCounts: [...this.channelCounts.values()],
      voiceSeconds: [...this.voiceSeconds.values()],
      memberFlow: [...this.memberFlow.values()],
    };
    this.counts = new Map();
    this.channelCounts = new Map();
    this.voiceSeconds = new Map();
    this.memberFlow = new Map();
    this.members = new Map();
    this.channels = new Map();
    return drained;
  }

  /**
   * Put back drained data that was never sent, so it goes out next flush. Counts are added
   * to anything that arrived meanwhile; members only fill gaps, since newer snapshots win.
   */
  restore({ members, channels, counts, channelCounts, voiceSeconds, memberFlow }: Drained): void {
    for (const m of members) {
      if (!this.members.has(m.user_id)) this.members.set(m.user_id, m);
    }
    for (const ch of channels) {
      if (!this.channels.has(ch.channel_id)) this.channels.set(ch.channel_id, ch);
    }
    for (const c of counts) this.addCount(c);
    for (const c of channelCounts) this.addChannelCount(c);
    for (const v of voiceSeconds) this.addVoice(v);
    for (const f of memberFlow) this.addFlow(f);
  }
}

export interface ActivityWriter {
  upsertMembers(rows: MemberRow[]): Promise<void>;
  upsertChannels(rows: ChannelRow[]): Promise<void>;
  /** Must apply each batch id at most once, however often it is sent. */
  incrementCounts(batch: CountBatch): Promise<void>;
}

/**
 * Write everything buffered. Members, channels and counts are drained together, so every
 * count's member and channel are written before it (counts reference both). A pending batch goes before the
 * new one; whatever fails is kept for the next flush, so a database hiccup loses no
 * messages and, thanks to the batch id, double counts none either.
 */
export async function flushActivity(
  buffer: ActivityBuffer,
  writer: ActivityWriter,
  newBatchId: () => string = randomUUID,
): Promise<void> {
  if (buffer.isEmpty) return;
  const drained = buffer.drain();
  const { members, channels, counts, channelCounts, voiceSeconds, memberFlow } = drained;
  try {
    if (members.length) await writer.upsertMembers(members);
    if (channels.length) await writer.upsertChannels(channels);
    if (buffer.pending) {
      await writer.incrementCounts(buffer.pending);
      buffer.pending = null;
    }
  } catch (err) {
    buffer.restore(drained);
    throw err;
  }
  if (!counts.length && !channelCounts.length && !voiceSeconds.length && !memberFlow.length) {
    return;
  }
  const batch = { id: newBatchId(), counts, channelCounts, voiceSeconds, memberFlow };
  try {
    await writer.incrementCounts(batch);
  } catch (err) {
    buffer.pending = batch;
    throw err;
  }
}
