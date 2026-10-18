import { ApplicationCommandOptionType, type APIEmbed } from "discord.js";
import { wallClock } from "./zone.js";

/** Slash commands registered for our guild; plain data so it can be sent as-is to Discord. */
export const STATS_COMMANDS = [
  {
    name: "leaderboard",
    description: "Top 10 members by messages",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "period",
        description: "This week (default) or all time",
        choices: [
          { name: "week", value: "week" },
          { name: "all", value: "all" },
        ],
      },
    ],
  },
  { name: "me", description: "Your own message and reaction counts" },
  {
    name: "channel",
    description: "Message volume of a channel over the last 30 days",
    options: [
      {
        type: ApplicationCommandOptionType.Channel,
        name: "channel",
        description: "Defaults to this channel",
      },
    ],
  },
] as const;

export const CHANNEL_DAYS = 30;

export type Period = "week" | "all";

export interface LeaderboardRow {
  user_id: string;
  display_name: string;
  message_count: number;
}

export interface DayCount {
  day: string; // UTC day, YYYY-MM-DD
  count: number;
}

export interface HourCount {
  hour: string; // start of the UTC hour, ISO timestamp
  count: number;
}

/** Sum of the counts on or after `since` (YYYY-MM-DD compares as text), or all when null. */
export function sumSince(rows: DayCount[], since: string | null): number {
  return rows.reduce((sum, r) => (since === null || r.day >= since ? sum + r.count : sum), 0);
}

/**
 * 1 + members with strictly more messages, so ties share a rank. `rows` holds visible
 * members only; a hidden caller still gets the rank they would have. Null without messages.
 */
export function rankOf(rows: LeaderboardRow[], userId: string, count: number): number | null {
  if (count === 0) return null;
  return 1 + rows.filter((r) => r.user_id !== userId && r.message_count > count).length;
}

/** Hour of day (0-23) in `timeZone` with the most messages, or null when there are none. */
export function busiestHour(rows: HourCount[], timeZone: string): number | null {
  const byHour = new Array<number>(24).fill(0);
  for (const r of rows) byHour[new Date(wallClock(Date.parse(r.hour), timeZone)).getUTCHours()] += r.count;
  const max = Math.max(...byHour);
  return max === 0 ? null : byHour.indexOf(max);
}

const n = (value: number) => value.toLocaleString("en-US");
const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
// An unset SITE_URL leaves the link out rather than linking somewhere wrong.
const link = (siteUrl: string | null, path: string) =>
  siteUrl ? { url: `${siteUrl.replace(/\/+$/, "")}${path}` } : {};

export function leaderboardEmbed(
  period: Period,
  rows: LeaderboardRow[],
  weekStart: string,
  siteUrl: string | null,
  timeZone: string,
): APIEmbed {
  const description = rows.length
    ? rows.map((r, i) => `**${i + 1}.** ${r.display_name}: ${n(r.message_count)}`).join("\n")
    : "No messages counted yet.";
  return {
    title: period === "week" ? "Leaderboard: this week" : "Leaderboard: all time",
    ...link(siteUrl, "/leaderboard"),
    description,
    ...(period === "week" && { footer: { text: `Since Monday ${weekStart} (${timeZone})` } }),
  };
}

export interface MeStats {
  displayName: string;
  week: number;
  allTime: number;
  weekRank: number | null;
  allTimeRank: number | null;
  reactionsReceived: number;
  hidden: boolean;
}

export function meEmbed(stats: MeStats, siteUrl: string | null): APIEmbed {
  const rank = (r: number | null) => (r === null ? "" : ` (rank #${r})`);
  return {
    title: `Stats for ${stats.displayName}`,
    ...link(siteUrl, "/leaderboard"),
    fields: [
      { name: "Messages this week", value: `${n(stats.week)}${rank(stats.weekRank)}`, inline: true },
      {
        name: "Messages all time",
        value: `${n(stats.allTime)}${rank(stats.allTimeRank)}`,
        inline: true,
      },
      { name: "Reactions received", value: n(stats.reactionsReceived), inline: true },
    ],
    ...(stats.hidden && {
      footer: { text: "You are hidden from the website. Use /show-me to appear again." },
    }),
  };
}

export function channelEmbed(name: string, rows: HourCount[], siteUrl: string | null, timeZone: string): APIEmbed {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const hour = busiestHour(rows, timeZone);
  return {
    title: `#${name}`,
    ...link(siteUrl, "/channels"),
    fields: [
      { name: `Messages, last ${CHANNEL_DAYS} days`, value: n(total), inline: true },
      {
        name: "Busiest hour",
        value: hour === null ? "None yet" : `${hh(hour)}-${hh((hour + 1) % 24)} ${timeZone}`,
        inline: true,
      },
    ],
  };
}
