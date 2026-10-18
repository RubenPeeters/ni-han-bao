import type { APIEmbed } from "discord.js";
import { fromWallClock, weekStart } from "./zone.js";

const REPORT_HOUR = 9; // Monday, local time
const DAY_MS = 24 * 60 * 60_000;
// A bot that was down on Monday still posts, but a report a day late is stale news.
const LATE_LIMIT_MS = DAY_MS;

/** Monday 09:00 in `timeZone` of the (local) week containing `now`, as a UTC instant. */
export function reportSlot(now: Date, timeZone: string): Date {
  return new Date(fromWallClock(Date.parse(weekStart(now, timeZone)) + REPORT_HOUR * 60 * 60_000, timeZone));
}

/** Monday (YYYY-MM-DD, local week) of the week whose report card is due at `now`, or null. */
export function dueReportWeek(now: Date, timeZone: string): string | null {
  const slot = reportSlot(now, timeZone).getTime();
  const late = now.getTime() - slot;
  if (late < 0 || late >= LATE_LIMIT_MS) return null;
  return addDays(weekStart(new Date(slot), timeZone), -7);
}

/** The day `days` after a YYYY-MM-DD day. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** What report_card() returns. Hidden members are already left out of top_talkers. */
export interface ReportData {
  top_talkers: { display_name: string; message_count: number }[];
  busiest_channel: { name: string; message_count: number } | null;
  top_emoji: {
    emoji_key: string;
    emoji_id: string | null;
    name: string | null;
    animated: boolean;
    reaction_count: number;
  } | null;
  joins: number;
  leaves: number;
}

const n = (value: number) => value.toLocaleString("en-US");
const times = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

function emojiText(e: NonNullable<ReportData["top_emoji"]>): string {
  if (!e.emoji_id) return e.emoji_key;
  return `<${e.animated ? "a" : ""}:${e.name ?? "emoji"}:${e.emoji_id}>`;
}

function growthText(joins: number, leaves: number): string {
  const net = joins - leaves;
  const sign = net > 0 ? "+" : "";
  const quip =
    net > 0
      ? "Welcome to the family. Wipe your feet."
      : net < 0
        ? "People left. Was it something I said?"
        : "Not one new face. Fine. It's fine.";
  return `${sign}${n(net)} (${n(joins)} joined, ${n(leaves)} left)\n${quip}`;
}

const reportTitle = (week: string) => `Weekly report card: week of ${week}`;

/** Whether `embeds` (of a message the bot posted) are the report card for `week`. */
export function isReportFor(embeds: readonly { title?: string | null }[], week: string): boolean {
  return embeds.some((e) => e.title === reportTitle(week));
}

export const PAGE_SIZE = 100; // Discord's maximum per history request

/**
 * Whether any message posted at or after `since` matches, paging back through the channel
 * history newest first (`fetchPage(before)` returns up to PAGE_SIZE messages before that id).
 * A failed fetch rejects, so the caller does not post on a search that never finished.
 */
export async function postedSince<M extends { id: string; createdTimestamp: number }>(
  fetchPage: (before: string | undefined) => Promise<readonly M[]>,
  since: number,
  matches: (m: M) => boolean,
): Promise<boolean> {
  let before: string | undefined;
  for (;;) {
    const page = await fetchPage(before);
    if (page.some((m) => m.createdTimestamp >= since && matches(m))) return true;
    if (page.length < PAGE_SIZE) return false;
    const oldest = page.reduce((a, b) => (b.createdTimestamp < a.createdTimestamp ? b : a));
    if (oldest.createdTimestamp < since) return false;
    before = oldest.id;
  }
}

/** Last week's report card, in the voice of a mildly disappointed dad. Teases the server, never a member. */
export function reportEmbed(week: string, data: ReportData, siteUrl: string | null, timeZone: string): APIEmbed {
  const medals = ["🥇", "🥈", "🥉"];
  const talkers = data.top_talkers.length
    ? data.top_talkers
        .map((t, i) => `${medals[i]} ${t.display_name}: ${times(t.message_count, "message", "messages")}`)
        .join("\n")
    : "Nobody said a word. Not one. I'm not angry, just disappointed.";
  const channel = data.busiest_channel
    ? `#${data.busiest_channel.name}: ${times(data.busiest_channel.message_count, "message", "messages")}`
    : "Tumbleweeds in every channel.";
  const emoji = data.top_emoji
    ? `${emojiText(data.top_emoji)} ${times(data.top_emoji.reaction_count, "time", "times")}`
    : "No reactions at all. Tough crowd.";
  const intro = data.top_talkers.length
    ? "Report card's in. Sit down, we need to talk."
    : "Report card's in. There isn't much on it.";
  return {
    title: reportTitle(week),
    ...(siteUrl && { url: siteUrl }),
    description: intro,
    fields: [
      { name: "Top talkers", value: talkers },
      { name: "Busiest channel", value: channel, inline: true },
      { name: "Top emoji", value: emoji, inline: true },
      { name: "Member growth", value: growthText(data.joins, data.leaves) },
    ],
    footer: { text: `Monday ${week} to Sunday ${addDays(week, 6)} (${timeZone})` },
  };
}
