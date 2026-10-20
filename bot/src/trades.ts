// Riftbound trade matching (#178): a member's wishlist against other members' cards for
// trade, within a server they share. The bot only introduces people: no prices, payments or
// escrow (Riot's monetization and middle-man rules); the trade happens at the table.
import { eventLabel } from "./events.js";
import { escapeMarkdown } from "./stores.js";
import { fits, type Wanted } from "./wishlist.js";

/** Where two members could meet, from riftbound_meeting_place(): null kind when nowhere is known. */
export interface Place {
  place_kind: "event" | "regulars" | "city" | null;
  event_name: string | null;
  starts_at: string | null;
  store_name: string | null;
  store_city: string | null;
}

/** A row of riftbound_trade_candidates(): copies of one printing and language a trader offers. */
export interface Candidate extends Place {
  guild_id: string;
  user_id: string;
  trader_id: string;
  card_id: string;
  printing_id: string;
  language: string;
  copies: number;
}

/** One card a member wants and another has for trade, in the server with the best place to meet. */
export interface Match extends Place {
  guild_id: string;
  trader_id: string;
  card_id: string;
  copies: number;
}

const RANK = { event: 0, regulars: 1, city: 2 } as const;
const rank = (p: Place) => (p.place_kind ? RANK[p.place_kind] : 3);

/**
 * The new matches per wanter: candidates whose printing and language fit something still
 * wanted (wishlist() of the wanter's rows), copies added up per server, one server per
 * trader and card.
 */
export function newMatches(candidates: Candidate[], wantedOf: (user: string) => Wanted[]): Map<string, Match[]> {
  const best = new Map<string, Match & { user_id: string }>();
  const perGuild = new Map<string, Match & { user_id: string }>();
  const wanted = new Map<string, Wanted[]>();
  for (const c of candidates) {
    if (!wanted.has(c.user_id)) wanted.set(c.user_id, wantedOf(c.user_id).filter((w) => w.wanted > 0));
    if (!wanted.get(c.user_id)!.some((w) => w.card_id === c.card_id && fits(c, w))) continue;
    const key = `${c.user_id}|${c.trader_id}|${c.card_id}`;
    const inGuild = perGuild.get(`${key}|${c.guild_id}`);
    if (inGuild) inGuild.copies += c.copies;
    else {
      const { printing_id: _p, language: _l, ...match } = c;
      perGuild.set(`${key}|${c.guild_id}`, match);
    }
    const m = perGuild.get(`${key}|${c.guild_id}`)!;
    const was = best.get(key);
    if (!was || rank(m) < rank(was)) best.set(key, m);
  }
  const out = new Map<string, Match[]>();
  for (const { user_id, ...m } of best.values()) out.set(user_id, [...(out.get(user_id) ?? []), m]);
  return out;
}

/** "at Riftbound Nexus Night: Sat 25 Oct, 19:00 · The Card Corner (Leuven)", or null. Never an address. */
export function placeText(place: Place, timeZone: string): string | null {
  // Store and event names are typed by members.
  const safe = (text: string | null) => text && escapeMarkdown(text);
  const store = place.store_name ? `${safe(place.store_name)} (${safe(place.store_city)})` : null;
  if (place.place_kind === "event" && place.starts_at) {
    const event = { name: safe(place.event_name), starts_at: place.starts_at, store_name: safe(place.store_name), store_city: safe(place.store_city) };
    return `you are both going to ${eventLabel(event, timeZone)}`;
  }
  if (place.place_kind === "regulars" && store) return `you are both regulars at ${store}`;
  if (place.place_kind === "city" && store) return `the nearest store is ${store}`;
  return null;
}

/** The one DM a member gets for the matches found since the last one. */
export function tradeDm(
  matches: Match[],
  cardName: (card: string) => string,
  timeZone: (guild: string) => string,
  siteUrl: string | null,
): string {
  const lines = matches.map((m) => {
    const place = placeText(m, timeZone(m.guild_id));
    return `- You want **${escapeMarkdown(cardName(m.card_id))}**: <@${m.trader_id}> has ${m.copies} for trade.${place ? ` Meet up: ${place}.` : ""}`;
  });
  const guilds = [...new Set(matches.map((m) => m.guild_id))];
  const page = siteUrl ? `\nAll your matches: ${guilds.map((g) => `<${siteUrl}/s/${g}/trades>`).join(" ")}` : "";
  const text =
    `${matches.length === 1 ? "A new trade match" : "New trade matches"} in your servers:\n${lines.join("\n")}\n` +
    `Say hi and trade at the table: no prices or payments go through the bot.${page}`;
  // shortcut: a long list is cut at Discord's 2000 characters; the Trades page has them all.
  return text.length <= 2000 ? text : `${text.slice(0, 1997)}...`;
}
