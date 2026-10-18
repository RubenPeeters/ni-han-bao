export interface LiveStats {
  messagesToday: number;
  /** Name of today's busiest channel, null before anyone has posted today. */
  busiestChannel: string | null;
  members: number;
}

/** The statuses the bot rotates through. {placeholders} are filled from LiveStats. */
export const PRESENCE_PHRASES = [
  "watching {messages} messages today",
  "judging #{channel}",
  "counting {members} members",
  "not reading your messages, promise",
];

const n = (value: number) => value.toLocaleString("en-US");

/** The phrase with its placeholders filled in, or null when one has no value yet. */
export function fillPhrase(phrase: string, stats: LiveStats): string | null {
  const values: Record<string, string | null> = {
    messages: n(stats.messagesToday),
    channel: stats.busiestChannel,
    members: n(stats.members),
  };
  let missing = false;
  const text = phrase.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key] ?? null;
    if (value === null) missing = true;
    return value ?? "";
  });
  return missing ? null : text;
}

/** First phrase from `index` on (wrapping) that can be filled, and the index after it. */
export function nextPresence(
  phrases: readonly string[],
  index: number,
  stats: LiveStats,
): { text: string; next: number } | null {
  for (let i = 0; i < phrases.length; i++) {
    const at = (index + i) % phrases.length;
    const text = fillPhrase(phrases[at], stats);
    if (text !== null) return { text, next: (at + 1) % phrases.length };
  }
  return null;
}
