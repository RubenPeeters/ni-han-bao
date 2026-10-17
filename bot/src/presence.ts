export interface LiveStats {
  messagesToday: number;
  /** Name of the channel with the most messages today (UTC), or null before the first one. */
  busiestChannel: string | null;
  memberCount: number;
}

const n = (value: number) => value.toLocaleString("en-US");

/** The rotating statuses, in order. Each returns null to be skipped when it has nothing to say. */
export const PRESENCE_PHRASES: ((s: LiveStats) => string | null)[] = [
  (s) => `watching ${n(s.messagesToday)} messages today`,
  (s) => (s.busiestChannel ? `judging #${s.busiestChannel}` : null),
  (s) => `keeping an eye on ${n(s.memberCount)} members`,
  () => "not reading your messages, just counting them",
];

/** The status for rotation step `turn`: the first phrase from there on that has something to say. */
export function presenceText(stats: LiveStats, turn: number): string {
  for (let i = 0; i < PRESENCE_PHRASES.length; i++) {
    const text = PRESENCE_PHRASES[(turn + i) % PRESENCE_PHRASES.length](stats);
    if (text) return text;
  }
  return "counting";
}
