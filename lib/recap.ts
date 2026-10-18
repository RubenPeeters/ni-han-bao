/** What monthly_recap() returns. Hidden members are already left out of top_talkers. */
export interface RecapData {
  server: string | null;
  top_talkers: { display_name: string; message_count: number }[];
  busiest_channel: { name: string; message_count: number } | null;
  top_emoji: { emoji_key: string; emoji_id: string | null; name: string | null; reaction_count: number } | null;
  peak_hour: number | null;
  busiest_day: { day: string; message_count: number } | null;
  messages: number;
}

/** The first day (YYYY-MM-DD) of a `YYYY-MM` route segment, or null when it is not one. */
export function recapMonth(segment: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(segment) ? `${segment}-01` : null;
}

export const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const n = (value: number) => value.toLocaleString("en-US");

/** "September 2026" for 2026-09-01. */
export const monthLabel = (month: string) =>
  new Date(`${month}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "21:00 to 22:00": the hour of day on the server's clock. */
export const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, "0")}:00 to ${String((hour + 1) % 24).padStart(2, "0")}:00`;

/** One line of trivia from the month's totals; never about a single member. */
export function funFact(data: RecapData): string {
  if (!data.messages || !data.busiest_day) return "Not a single message all month. Peaceful, honestly.";
  const day = new Date(`${data.busiest_day.day}T00:00:00Z`).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const share = Math.round((data.busiest_day.message_count / data.messages) * 100);
  return `${n(data.messages)} ${data.messages === 1 ? "message" : "messages"} in total. ${day} alone had ${share}% of them.`;
}

/** The card as text: the image's alt, for anyone who cannot see it. */
export function recapAlt(month: string, data: RecapData): string {
  const talkers = data.top_talkers.map((t) => `${t.display_name} (${n(t.message_count)})`).join(", ");
  return [
    `Monthly recap for ${monthLabel(month)}.`,
    `Top chatters: ${talkers || "nobody"}.`,
    `Busiest channel: ${data.busiest_channel ? `#${data.busiest_channel.name}` : "none"}.`,
    `Top emoji: ${data.top_emoji ? (data.top_emoji.name ?? data.top_emoji.emoji_key) : "none"}.`,
    `Peak hour: ${data.peak_hour === null ? "none" : hourLabel(data.peak_hour)}.`,
    funFact(data),
  ].join(" ");
}
