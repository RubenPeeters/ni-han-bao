// Riftbound trade matching (#178): a member's wishlist against other members' cards for
// trade, within a server they share. The bot only introduces people: no prices, payments or
// escrow (Riot's monetization and middle-man rules); the trade happens at the table.
import { ComponentType, MessageFlags, type APITextDisplayComponent } from "discord.js";
import { eventLabel } from "./events.js";
import { type Catalogue } from "./riftbound.js";
import { imageOf, withThumbnail, type V2 } from "./riftbound-reply.js";
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
  /** How many of the card the wanter still wants. */
  wanted: number;
}

const RANK = { event: 0, regulars: 1, city: 2 } as const;
const rank = (p: Place) => (p.place_kind ? RANK[p.place_kind] : 3);

/**
 * The new matches per wanter: candidates whose printing and language fit something still
 * wanted (wishlist() of the wanter's rows) for the decks or by hand, copies added up per
 * server, one server per trader and card. The playset goal (#330) never sends a DM.
 */
export function newMatches(candidates: Candidate[], wantedOf: (user: string) => Wanted[]): Map<string, Match[]> {
  const best = new Map<string, Match & { user_id: string }>();
  const perGuild = new Map<string, Match & { user_id: string }>();
  const wanted = new Map<string, Wanted[]>();
  for (const c of candidates) {
    if (!wanted.has(c.user_id)) wanted.set(c.user_id, wantedOf(c.user_id).filter((w) => w.wanted > w.playset));
    if (!wanted.get(c.user_id)!.some((w) => w.card_id === c.card_id && fits(c, w))) continue;
    const key = `${c.user_id}|${c.trader_id}|${c.card_id}`;
    const inGuild = perGuild.get(`${key}|${c.guild_id}`);
    if (inGuild) inGuild.copies += c.copies;
    else {
      const { printing_id: _p, language: _l, ...match } = c;
      const want = wanted.get(c.user_id)!.reduce((n, w) => n + (w.card_id === c.card_id ? w.wanted - w.playset : 0), 0);
      perGuild.set(`${key}|${c.guild_id}`, { ...match, wanted: want });
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

// Matches shown with their pictures; the rest are on the Trades page.
export const DM_MATCHES = 5;

/**
 * The one DM a member gets for the matches found since the last one, and the matches it
 * covers: the first five with their pictures, the rest by a link to the Trades page. Without
 * the site to link to, the rest wait for the next DM.
 */
export function tradeDm(
  matches: Match[],
  catalogue: Catalogue,
  timeZone: (guild: string) => string,
  siteUrl: string | null,
): { message: V2; shown: Match[] } {
  const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });
  const section = (m: Match) => {
    const card = catalogue.cards.find((c) => c.id === m.card_id);
    const place = placeText(m, timeZone(m.guild_id));
    const content = [
      `**${escapeMarkdown(card?.name ?? m.card_id)}**`,
      `You want ${m.wanted}, <@${m.trader_id}> has ${m.copies} for trade.`,
      place && `Meet up: ${place}.`,
    ];
    return withThumbnail(content.filter(Boolean).join("\n"), card ? imageOf(catalogue, card, 160) : null, card?.name ?? m.card_id);
  };
  const rest = matches.length - DM_MATCHES;
  const pages = [...new Set(matches.map((m) => m.guild_id))].map((g) => `<${siteUrl}/s/${g}/trades>`).join(" ");
  const more = rest > 0 && (siteUrl ? `And ${rest} more on the Trades page: ${pages}` : `And ${rest} more in your next DM.`);
  const footer = `-# Say hi and trade at the table: no prices or payments go through the bot.${siteUrl && rest <= 0 ? ` All your matches: ${pages}` : ""}`;
  return {
    message: {
      components: [
        {
          type: ComponentType.Container,
          components: [
            text(`### ${matches.length === 1 ? "A new trade match" : "New trade matches"} in your servers`),
            ...matches.slice(0, DM_MATCHES).map(section),
            ...(more ? [text(more)] : []),
            text(footer),
          ],
        },
      ],
      flags: MessageFlags.IsComponentsV2,
    },
    shown: siteUrl ? matches : matches.slice(0, DM_MATCHES),
  };
}
