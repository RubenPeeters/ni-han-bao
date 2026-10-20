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

// A collector code without case, dashes or spaces: "ogn 001" is "OGN-001".
export const codeKey = (text: string) => text.replace(/[\s-]+/g, "").toLowerCase();

/**
 * The cards printed under a typed collector code or one of its variants ("OGN-007" for
 * "OGN-007a/298" and "OGN-007b/298"), which can be several cards.
 */
function cardsByCode({ cards, printings }: Catalogue, typed: string): Card[] {
  const q = codeKey(typed);
  if (!/\d/.test(q)) return [];
  // The code itself and its suffixed variants together: "OGN-007" and "OGN-007a" may be two cards.
  // Riot prints the set's size after a slash ("OGN-007/298"), which nobody needs to type.
  const matched = printings.filter((p) => { const k = codeKey(p.collector_code); return k.startsWith(q) && /^[a-z*]*(\/\d+)?$/.test(k.slice(q.length)); });
  const ids = new Set(matched.map((p) => p.card_id));
  return cards.filter((c) => ids.has(c.id));
}

export type Resolved = { card: Card } | { ambiguous: Card[] } | null;

/**
 * What a member typed, to one card: its exact name or, for legends, "Champion, Epithet" or
 * the bare champion name, or a collector code. More than one match is ambiguous, never guessed.
 */
export function resolveCard(catalogue: Catalogue, typed: string): Resolved {
  const q = normal(typed);
  if (!q) return null;
  const byCode = new Set(cardsByCode(catalogue, typed));
  const found = catalogue.cards.filter(
    (c) =>
      byCode.has(c) ||
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
