import type { APIEmbed } from "discord.js";
import type { EmojiRow } from "./reactions.js";

const TIME_ZONE = "Europe/Brussels";
const REPORT_HOUR = 9;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Brussels wall-clock time at `at`, written as if it were UTC (so getUTC* read it back). */
function brussels(at: Date): Date {
  const p = Object.fromEntries(wallClock.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/** The instant it is 09:00 in Brussels on the given Brussels date (day may under- or overflow). */
function nineInBrussels(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month, day, REPORT_HOUR);
  // DST switches happen at night, never between 07:00 and 09:00 UTC, so one correction is exact.
  const offset = brussels(new Date(guess)).getTime() - guess;
  return new Date(guess - offset);
}

/**
 * The UTC week (its Monday, YYYY-MM-DD) the latest report is due for: the report for a
 * week is due from 09:00 Brussels the Monday after it. At that hour it is Monday in UTC
 * too, so the week matches the UTC weeks used everywhere else.
 */
export function reportWeek(now: Date): string {
  const local = brussels(now);
  const monday = local.getUTCDate() - ((local.getUTCDay() + 6) % 7);
  let due = nineInBrussels(local.getUTCFullYear(), local.getUTCMonth(), monday);
  if (due > now) due = nineInBrussels(local.getUTCFullYear(), local.getUTCMonth(), monday - 7);
  const week = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate() - 7);
  return new Date(week).toISOString().slice(0, 10);
}

/** What report_card() returns. Hidden members are already left out of top_talkers. */
export interface ReportCard {
  top_talkers: { display_name: string; message_count: number }[];
  busiest_channel: { name: string; message_count: number } | null;
  top_emoji: (EmojiRow & { reaction_count: number }) | null;
  joins: number;
  leaves: number;
}

const n = (value: number) => value.toLocaleString("en-US");

function emojiText(e: EmojiRow): string {
  if (!e.emoji_id) return e.emoji_key;
  // Discord renders by id; the name only has to be present.
  return `<${e.animated ? "a" : ""}:${e.name ?? "emoji"}:${e.emoji_id}>`;
}

// Disappointed at the server as a whole, never at a person.
function growthText(joins: number, leaves: number): string {
  const growth = joins - leaves;
  const counts = `${growth > 0 ? "+" : ""}${n(growth)} (${n(joins)} joined, ${n(leaves)} left)`;
  if (growth > 0) return `${counts}. Proud of you. Don't let it go to your head.`;
  if (growth < 0) return `${counts}. People leave. It happens. I'm fine.`;
  return `${counts}. Same as last week. Steady, like my disappointment.`;
}

export function reportCardEmbed(week: string, card: ReportCard): APIEmbed {
  const quiet = card.top_talkers.length === 0;
  const talkers = card.top_talkers
    .map((t, i) => `**${i + 1}.** ${t.display_name}: ${n(t.message_count)} messages`)
    .join("\n");
  const channel = card.busiest_channel;
  const emoji = card.top_emoji;
  const end = new Date(Date.parse(week) + 6 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return {
    title: `Weekly report card: ${week} to ${end}`,
    description: quiet
      ? "Not a single message all week. I'm not angry. I'm just disappointed."
      : "I've looked at last week's numbers. Sit down, we need to talk.",
    fields: [
      {
        name: "Top talkers",
        value: quiet ? "Nobody. Not one of you." : `${talkers}\nAt least someone is trying.`,
      },
      {
        name: "Busiest channel",
        value: channel
          ? `#${channel.name}: ${n(channel.message_count)} messages. Would it kill you to try another one?`
          : "None. The channels are gathering dust.",
      },
      {
        name: "Top emoji",
        value: emoji
          ? `${emojiText(emoji)} used ${n(emoji.reaction_count)} times. Use your words.`
          : "No reactions at all. Tough crowd.",
      },
      { name: "Member growth", value: growthText(card.joins, card.leaves) },
    ],
    footer: { text: "Monday to Sunday, UTC" },
  };
}
