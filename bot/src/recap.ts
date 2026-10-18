import type { APIEmbed } from "discord.js";
import { fromWallClock, localDay } from "./zone.js";

const RECAP_HOUR = 9; // the 1st of the month, local time
const DAY_MS = 24 * 60 * 60_000;

export const RECAP_COMMAND = { name: "recap", description: "Post last month's recap card" } as const;

/** The first day (YYYY-MM-01) of the month `months` after the one containing `day` (YYYY-MM-DD). */
export function addMonths(day: string, months: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** The first day of last month in `timeZone`: the month /recap shows. */
export const lastMonth = (now: Date, timeZone: string) => addMonths(localDay(now, timeZone), -1);

/** 09:00 in `timeZone` on the 1st of the (local) month containing `now`, as a UTC instant. */
export function recapSlot(now: Date, timeZone: string): Date {
  const first = Date.parse(addMonths(localDay(now, timeZone), 0));
  return new Date(fromWallClock(first + RECAP_HOUR * 60 * 60_000, timeZone));
}

/** The month (YYYY-MM-01) whose recap is due at `now`, or null. A day late is still posted, later is stale. */
export function dueRecapMonth(now: Date, timeZone: string): string | null {
  const late = now.getTime() - recapSlot(now, timeZone).getTime();
  return late >= 0 && late < DAY_MS ? lastMonth(now, timeZone) : null;
}

const recapTitle = (month: string) =>
  `Monthly recap: ${new Date(`${month}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;

/** Whether `embeds` (of a message the bot posted) are the recap for `month`. */
export function isRecapFor(embeds: readonly { title?: string | null }[], month: string): boolean {
  return embeds.some((e) => e.title === recapTitle(month));
}

/** The site's recap page, and the card image the bot fetches with the month's key. */
export function recapUrls(siteUrl: string, guild: string, month: string, key: string) {
  const page = `${siteUrl.replace(/\/$/, "")}/s/${guild}/recap/${month.slice(0, 7)}`;
  return { page, image: `${page}/og?key=${encodeURIComponent(key)}` };
}

/** The message: the card as an attachment, since Discord cannot fetch a members-only image itself. */
export function recapMessage(month: string, image: Buffer, pageUrl: string) {
  const name = `recap-${month.slice(0, 7)}.png`;
  const embed: APIEmbed = { title: recapTitle(month), url: pageUrl, image: { url: `attachment://${name}` } };
  return { embeds: [embed], files: [{ attachment: image, name }] };
}
