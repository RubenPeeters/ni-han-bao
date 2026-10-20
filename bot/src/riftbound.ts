// The Riftbound card catalogue (#148): placeholder cards until Riot approves the API key
// (#96), and the replies about cards. Rows have the columns of riftbound_cards and
// riftbound_printings, so the real API can fill the same tables later.

import { ApplicationCommandOptionType, type APIEmbed } from "discord.js";
import { codeKey, normal, resolveCard, type Card, type Catalogue, type Printing, type Resolved } from "./card-match.js";

export { codeKey, resolveCard, type Card, type Catalogue, type Printing, type Resolved };

/** Data Dragon's champion.json entries: only what the placeholders use. */
export interface Champion {
  id: string;
  key: string;
  name: string;
}

export const PLACEHOLDER_SET = "PLH";
const DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
// 32 by 32: an epithet per champion key below 1024, so no two legends share one.
const ADJECTIVES = ["Ashen", "Bright", "Crimson", "Distant", "Ember", "Frozen", "Gilded", "Hollow", "Iron", "Jade",
  "Lunar", "Molten", "Quiet", "Restless", "Silver", "Sunken", "Tidal", "Verdant", "Wandering", "Woven", "Amber",
  "Brazen", "Copper", "Dusky", "Feral", "Gentle", "Hidden", "Ivory", "Kindled", "Mossy", "Pale", "Rusted"];
const NOUNS = ["Blade", "Crown", "Dawn", "Echo", "Flame", "Gate", "Herald", "Lantern", "Oath", "Peak", "Rose",
  "Shadow", "Spark", "Thorn", "Tide", "Warden", "Anchor", "Banner", "Comet", "Drum", "Feather", "Grove", "Harbor",
  "Kite", "Mantle", "Needle", "Orchard", "Prism", "Quill", "River", "Saddle", "Veil"];
// Invented names. Append only: a card's number is its place here, and must not move.
const SPELLS = ["Quick Thought", "Borrowed Courage", "Second Wind", "Falling Star", "Sudden Squall", "Mirror Step",
  "Patient Strike", "Low Tide", "Bright Idea", "Rally Cry", "Stone Skin", "Cinder Rain", "Lucky Break",
  "Quiet Hour", "Double Back", "Last Light", "Open Road", "Small Miracle"];
const GEAR = ["Plain Shield", "Traveler's Boots", "Tin Crown", "Spare Lantern", "Iron Ring", "Wooden Sword",
  "Old Map", "Glass Charm", "Heavy Cloak", "Copper Bell", "Rope Ladder", "Lucky Coin", "Bone Flute",
  "Patched Banner", "Chalk Compass", "Clay Mask"];

/** FNV-1a: made-up stats that stay the same for the same card on every run. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
const pick = <T>(list: T[], seed: string) => list[hash(seed) % list.length];
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// shortcut: unique only while champion keys stay below 1024 (the highest is 950); add words then.
const epithet = (n: number) => `${ADJECTIVES[n % 32]} ${NOUNS[Math.floor(n / 32) % 32]}`;

/**
 * A legend and a unit per champion, plus generic spells and gear. Ids and collector codes
 * come from the champion's id and Riot's numeric key, and from the lists above, so a new
 * champion adds cards without moving any other.
 */
export function placeholderCatalogue(champions: Champion[]): Catalogue {
  const cards: Card[] = [];
  const printings: Printing[] = [];
  const add = (card: Omit<Card, "placeholder">, code: string, number: number, rarity: string, image: string) => {
    cards.push({ ...card, placeholder: true });
    printings.push({
      id: `${PLACEHOLDER_SET}-${code}`,
      card_id: card.id,
      set_code: PLACEHOLDER_SET,
      collector_code: `${PLACEHOLDER_SET}-${code}`,
      collector_number: number,
      rarity,
      illustrator: null,
      image_url: image,
    });
  };
  const sorted = [...champions].sort((a, b) => Number(a.key) - Number(b.key));
  for (const c of sorted) {
    const key = c.key.padStart(3, "0");
    // Referenced on Riot's CDN, never rehosted; portrait, close to a card's shape.
    const art = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c.id}_0.jpg`;
    const id = c.id.toLowerCase();
    const domains = [pick(DOMAINS, `d1${id}`), pick(DOMAINS, `d2${id}`)];
    // Legends are named by epithet; the champion is in tags, as on real cards.
    add({ id: `placeholder-legend-${id}`, name: epithet(Number(c.key)), type: "Legend", supertypes: [],
      domains: [...new Set(domains)].sort(), energy: null, might: null, tags: [c.name],
      rules_text: `Placeholder legend for ${c.name}. It has no real rules yet.` }, `L${key}`, Number(c.key), "Rare", art);
    add({ id: `placeholder-unit-${id}`, name: `${c.name}, ${epithet((Number(c.key) * 7) % 1024)}`, type: "Unit",
      supertypes: ["Champion"], domains: [domains[0]], energy: 1 + (hash(`e${id}`) % 8), might: 1 + (hash(`m${id}`) % 8),
      tags: [c.name], rules_text: "Placeholder unit. It has no real rules yet." },
    `U${key}`, Number(c.key), pick(["Common", "Uncommon", "Rare", "Epic"], `r${id}`), art);
  }
  for (const [type, names, letter, base] of [["Spell", SPELLS, "S", 1000], ["Gear", GEAR, "G", 1100]] as const) {
    names.forEach((name, i) => {
      const id = `placeholder-${type.toLowerCase()}-${slug(name)}`;
      add({ id, name, type, supertypes: [], domains: [pick(DOMAINS, `d${id}`)], energy: hash(`e${id}`) % 6,
        might: null, tags: [], rules_text: `Placeholder ${type.toLowerCase()}. It has no real rules yet.` },
      `${letter}${String(i + 1).padStart(2, "0")}`, base + i + 1, pick(["Common", "Uncommon"], `r${id}`),
      `/riftbound/${id}.svg`);
    });
  }
  return { cards, printings };
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The generated art of a spell or gear placeholder: its name and type, nothing external. */
export function placeholderSvg(card: Pick<Card, "name" | "type">): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="308" height="560" viewBox="0 0 308 560">
<rect width="308" height="560" rx="16" fill="#1f2430"/>
<rect x="12" y="12" width="284" height="536" rx="10" fill="none" stroke="#8a93a6" stroke-width="2" stroke-dasharray="8 6"/>
<text x="154" y="250" fill="#e6e9ef" font-family="sans-serif" font-size="26" font-weight="600" text-anchor="middle">${escapeXml(card.name)}</text>
<text x="154" y="290" fill="#b8bfcc" font-family="sans-serif" font-size="18" text-anchor="middle">${escapeXml(card.type)}</text>
<text x="154" y="520" fill="#b8bfcc" font-family="sans-serif" font-size="14" text-anchor="middle">Placeholder card</text>
</svg>
`;
}

/** One card per line, so a regenerated catalogue diffs by card. */
export function catalogueJson({ cards, printings }: { cards: object[]; printings: object[] }): string {
  const list = (rows: object[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return `{\n  "cards": [\n${list(cards)}\n  ],\n  "printings": [\n${list(printings)}\n  ]\n}\n`;
}

export const CARD_COMMAND = {
  name: "card",
  description: "Look up a Riftbound card",
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "name",
      description: "The card's name or collector code, or a legend's champion",
      required: true,
      autocomplete: true,
    },
  ],
} as const;

// Legends are named by epithet, so the champion goes in the label: typing "ahri" finds hers.
export const choiceLabel = (c: Card) => `${c.name} (${c.type === "Legend" ? `${c.tags.join(", ")} legend` : c.type})`;

/**
 * Autocomplete: up to Discord's 25, collector codes and then names starting with what was
 * typed first. The value is the card id.
 */
export function cardChoices({ cards, printings }: Catalogue, typed: string): { name: string; value: string }[] {
  const q = normal(typed);
  const code = codeKey(typed);
  // A code has a number: "plh" alone would suggest every placeholder.
  const coded = new Set(/\d/.test(code) ? printings.filter((p) => codeKey(p.collector_code).startsWith(code)).map((p) => p.card_id) : []);
  const starts = (c: Card) =>
    coded.has(c.id) ? 0 : normal(c.name).startsWith(q) || c.tags.some((t) => normal(t).startsWith(q)) ? 1 : 2;
  return cards
    .filter((c) => coded.has(c.id) || normal(choiceLabel(c)).includes(q))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((c) => ({ name: choiceLabel(c).slice(0, 100), value: c.id }));
}

/** The /card option: a picked suggestion is a card id, anything else is a typed name or code. */
export function lookupCard(catalogue: Catalogue, value: string): Resolved {
  const picked = catalogue.cards.find((c) => c.id === value);
  return picked ? { card: picked } : resolveCard(catalogue, value);
}

export function cardEmbed(card: Card, printings: Printing[], siteUrl: string | null): APIEmbed {
  // Discord renders no SVG and no relative URL, so the generated spell and gear art stays on the site.
  const image = printings.find((p) => p.image_url?.startsWith("https://"))?.image_url;
  const dash = (n: number | null) => (n === null ? "-" : String(n));
  // Made up until Riot approves the API key: nobody may mistake it for a real card.
  const footer = [card.placeholder && "Placeholder card", ...printings.map((p) => p.collector_code)].filter(Boolean).join(" · ");
  return {
    title: card.name,
    url: siteUrl ? `${siteUrl.replace(/\/$/, "")}/cards/${card.id}` : undefined,
    description: card.rules_text ?? undefined,
    fields: [
      { name: "Type", value: [...card.supertypes, card.type].join(" "), inline: true },
      { name: "Cost", value: dash(card.energy), inline: true },
      { name: "Might", value: dash(card.might), inline: true },
      { name: "Domains", value: card.domains.join(", ") || "-", inline: true },
    ],
    image: image ? { url: image } : undefined,
    footer: footer ? { text: footer } : undefined,
  };
}

/** The reply to a name or code that is not exactly one card. */
export function cardMiss(typed: string, ambiguous: Card[] | null): string {
  if (!ambiguous) return `No card called or numbered "${typed.slice(0, 100)}". Pick one from the suggestions.`;
  return `More than one card matches that: ${ambiguous.slice(0, 10).map(choiceLabel).join(", ")}. Pick one from the suggestions.`;
}
