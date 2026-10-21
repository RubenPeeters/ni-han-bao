// The card lookup every place that takes a typed card uses: the bot's commands and the
// site's deck paste (#173). No imports, so the site can import it from here as it is.

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

// Case, accents, spacing and apostrophes do not matter: "kaisa" is "Kai'Sa", "anivia" "Anivia".
export const normal = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/['‘’]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Riot's sets in release order, by code, with the feed's name for each (riftbound-feed.ts checks it). */
export const SET_NAMES: Record<string, string> = {
  OGN: "Origins",
  OGS: "Proving Grounds",
  SFD: "Spiritforged",
  UNL: "Unleashed",
  VEN: "Vendetta",
  RAD: "Radiance",
};

// A collector code without case, dashes or spaces: "ogn 001" is "OGN-001".
export const codeKey = (text: string) => text.replace(/[\s-]+/g, "").toLowerCase();

// Set (and Riot's R, T or SP), number, variant and the set's size: "OGN-034a/298", "VEN-R04", "VEN-SP3/006".
const PRINTED = /^([a-z]+)-([a-z]*)(\d+)([a-z*]*)(?:\/(\d+))?$/;
const TYPED = /^([a-z]*)(\d+)([a-z*]*)(?:\/(\d+))?$/;

/**
 * Whether a typed number is this collector code, by number, not by text (#223): "34" is the 34
 * of every set with every variant, "34a" only that variant, "ogn 34" only Origins', "r4"
 * "VEN-R04". Leading zeros, case, dashes and spaces do not matter; "34" is never 134 or 340.
 */
export function matchesCode(typed: string, code: string): boolean {
  const q = TYPED.exec(codeKey(typed));
  const c = PRINTED.exec(code.toLowerCase());
  if (!q || !c) return false;
  const [, letters, number, variant, size] = q;
  const [, set, prefix] = c;
  return (
    (letters === prefix || letters === set + prefix) &&
    Number(number) === Number(c[3]) &&
    (!variant || variant === c[4]) &&
    (!size || !c[5] || Number(size) === Number(c[5]))
  );
}

const SETS = Object.keys(SET_NAMES);
const setRank = (set: string) => (SETS.includes(set) ? SETS.indexOf(set) : SETS.length);

/** Set release order, then collector number: the 34s of every set together, set after set. */
export const byPrinting = (
  a: { set_code: string; collector_number: number; collector_code: string },
  b: { set_code: string; collector_number: number; collector_code: string },
) => setRank(a.set_code) - setRank(b.set_code) || a.collector_number - b.collector_number || a.collector_code.localeCompare(b.collector_code);

/** The cards a typed number finds, each at its first such printing in set order: Origins' 34 before Spiritforged's. */
export function codeRanks(printings: Printing[], typed: string): Map<string, number> {
  const ranks = new Map<string, number>();
  printings
    .filter((p) => matchesCode(typed, p.collector_code))
    .sort(byPrinting)
    .forEach((p, i) => ranks.has(p.card_id) || ranks.set(p.card_id, i));
  return ranks;
}

/** A search box's cards: name or champion containing what was typed, or its number (#223), numbers first in set order. */
export function findCards({ cards, printings }: Catalogue, typed: string): Card[] {
  const q = normal(typed);
  if (!q) return [];
  const coded = codeRanks(printings, typed);
  const rank = (c: Card) => coded.get(c.id) ?? coded.size;
  return cards
    .filter((c) => coded.has(c.id) || normal(c.name).includes(q) || c.tags.some((t) => normal(t).includes(q)))
    .sort((a, b) => rank(a) - rank(b));
}

export type Resolved = { card: Card } | { ambiguous: Card[] } | null;

/**
 * What a member typed, to one card: its exact name or, for legends, "Champion, Epithet" or
 * the bare champion name, or a collector code. More than one match is ambiguous, never guessed.
 */
export function resolveCard(catalogue: Catalogue, typed: string): Resolved {
  const q = normal(typed);
  if (!q) return null;
  const byCode = codeRanks(catalogue.printings, typed);
  const found = catalogue.cards.filter(
    (c) =>
      byCode.has(c.id) ||
      normal(c.name) === q ||
      (c.type === "Legend" && c.tags.some((t) => normal(t) === q || normal(`${t}, ${c.name}`) === q)),
  );
  return found.length === 0 ? null : found.length === 1 ? { card: found[0] } : { ambiguous: found };
}

/** Riot's card text is HTML (#203): its words unchanged, as lines, for Discord and plain text. */
export const plainText = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/p>\s*<p>|<li>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();

/** An icon token in Riot's card text (#218), ":rb_might:" read as "might", and what it says in words. */
export interface CardToken {
  kind: "might" | "rune" | "energy" | "other";
  // The domain id for a rune ("fury"), the number for energy.
  value: string;
  label: string;
}

const TOKEN = /:rb_([a-z0-9_]+):/g;
const words = (name: string) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function cardToken(name: string): CardToken {
  if (name === "might") return { kind: "might", value: name, label: "Might" };
  const rune = /^rune_([a-z]+)$/.exec(name);
  if (rune) return { kind: "rune", value: rune[1], label: `${words(rune[1])} rune` };
  const energy = /^energy_(\d+)$/.exec(name);
  if (energy) return { kind: "energy", value: energy[1], label: `${energy[1]} energy` };
  return { kind: "other", value: name, label: words(name) };
}

/** Text with its tokens apart, for rendering them: "+1 :rb_might:" is ["+1 ", might, ""]. */
export const textParts = (text: string): (string | CardToken)[] =>
  text.split(TOKEN).map((part, i) => (i % 2 ? cardToken(part) : part));

/** A card image at `width` pixels, from Riot's CDN: the originals are about 800 kB. Referenced, never rehosted. */
export function cardImageUrl(url: string, width: number): string {
  // Only Riot's CDN takes these parameters.
  if (!url.startsWith("https://cmsassets.rgpub.io/")) return url;
  const sized = new URL(url);
  sized.searchParams.set("w", String(width));
  sized.searchParams.set("fm", "webp");
  sized.searchParams.set("q", "75");
  return sized.toString();
}
