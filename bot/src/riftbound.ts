// The Riftbound card catalogue (#148): placeholder cards until Riot approves the API key
// (#96), and the name lookup every command that takes a card uses. Rows have the columns of
// riftbound_cards and riftbound_printings, so the real API can fill the same tables later.

export interface Card {
  id: string;
  name: string;
  type: string;
  supertypes: string[];
  domains: string[];
  energy: number | null;
  might: number | null;
  tags: string[];
  rules_text: string | null;
  placeholder: boolean;
}

export interface Printing {
  id: string;
  card_id: string;
  set_code: string;
  collector_code: string;
  collector_number: number;
  rarity: string | null;
  illustrator: string | null;
  image_url: string | null;
}

export interface Catalogue {
  cards: Card[];
  printings: Printing[];
}

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
export function catalogueJson({ cards, printings }: Catalogue): string {
  const list = (rows: object[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return `{\n  "cards": [\n${list(cards)}\n  ],\n  "printings": [\n${list(printings)}\n  ]\n}\n`;
}

// Case, accents and curly apostrophes do not matter: "kai’sa" is "Kai'Sa", "anivia" "Anivia".
const normal = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export type Resolved = { card: Card } | { ambiguous: Card[] } | null;

/**
 * What a member typed, to one card. The exact name wins; else, for legends, "Champion,
 * Epithet" or the bare champion name. More than one match is ambiguous, never guessed.
 */
export function resolveCard(cards: Card[], typed: string): Resolved {
  const q = normal(typed);
  if (!q) return null;
  const one = (found: Card[]): Resolved => (found.length === 1 ? { card: found[0] } : { ambiguous: found });
  const exact = cards.filter((c) => normal(c.name) === q);
  if (exact.length) return one(exact);
  const legends = cards.filter(
    (c) => c.type === "Legend" && c.tags.some((t) => normal(t) === q || normal(`${t}, ${c.name}`) === q),
  );
  return legends.length ? one(legends) : null;
}
