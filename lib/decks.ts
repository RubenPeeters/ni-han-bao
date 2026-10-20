// Riftbound decks (#173): pure, so the paste parser and the rules are tested without a browser.

export const SECTIONS = [
  { value: "main", label: "Main deck" },
  { value: "runes", label: "Runes" },
  { value: "battlefields", label: "Battlefields" },
  { value: "sideboard", label: "Sideboard" },
] as const;
export type Section = (typeof SECTIONS)[number]["value"];

/** The database's riftbound_decks.visibility values. */
export const VISIBILITIES = [
  { value: "private", label: "Private: only you" },
  { value: "servers", label: "Servers: your servers' members" },
  // Anyone logged in, as with a public profile: logged-out pages show nothing per person.
  { value: "public", label: "Public: anyone with the link" },
] as const;
export type Visibility = (typeof VISIBILITIES)[number]["value"];

export interface Entry {
  section: Section;
  card_id: string;
  /** Pinned: only this printing satisfies the entry. */
  printing_id: string | null;
  quantity: number;
}

/** Where a card goes by its type, as add_riftbound_deck_card() does it; null for a legend, which is the deck's Legend. */
export function sectionFor(type: string): Section | null {
  return type === "Legend" ? null : type === "Rune" ? "runes" : type === "Battlefield" ? "battlefields" : "main";
}

const same = (a: Omit<Entry, "quantity">, b: Omit<Entry, "quantity">) =>
  a.section === b.section && a.card_id === b.card_id && a.printing_id === b.printing_id;

/** `delta` copies more (or fewer) of an entry, merged with an identical one; none left drops it. */
export function changeEntry(entries: Entry[], entry: Omit<Entry, "quantity">, delta: number): Entry[] {
  const at = entries.findIndex((e) => same(e, entry));
  const quantity = Math.min(99, Math.max(0, (at < 0 ? 0 : entries[at].quantity) + delta));
  const rest = entries.filter((_, i) => i !== at);
  if (!quantity) return rest;
  const next = { ...entry, quantity };
  return at < 0 ? [...entries, next] : rest.toSpliced(at, 0, next);
}

/** An entry moved or re-pinned: changed in place, and merged if that makes it the same as another. */
export function replaceEntry(entries: Entry[], from: Entry, to: Omit<Entry, "quantity">): Entry[] {
  return changeEntry(changeEntry(entries, from, -from.quantity), to, from.quantity);
}

export interface PastedLine {
  /** The line as pasted, to show and to put back when it needs fixing. */
  text: string;
  quantity: number;
  /** The card's name or collector code, for resolveCard(). */
  typed: string;
  /** The heading it was under ("Sideboard:", "Champion:"), lowercased, if any. */
  heading: string | null;
}

// Deck lists often group their lines under headings; they say where a card goes, not which.
const HEADING = /^(legend|champion|main ?deck|main|runes?|battlefields?|sideboard)\s*(\(\d+\))?:?$/i;

/** "3 Card Name", "3x Card Name" or a bare name (one copy), one per line; blank lines and headings are no cards. */
export function parseDeckList(text: string): PastedLine[] {
  const lines: PastedLine[] = [];
  let heading: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = HEADING.exec(line);
    if (head) {
      heading = head[1].toLowerCase().replace(" ", "");
      continue;
    }
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    lines.push({ text: line, quantity: m ? Math.min(99, Number(m[1])) : 1, typed: m ? m[2] : line, heading });
  }
  return lines;
}

export interface DeckCards {
  legend_id: string | null;
  champion_id: string | null;
  entries: Entry[];
}

/**
 * A searched or pasted card into the deck: a legend becomes its Legend, anything else goes in
 * by type (the sideboard if listed under that heading). Listed under "Champion:", a Champion
 * unit also becomes the Chosen Champion; the rules check whether it matches the Legend.
 */
export function addCard(deck: DeckCards, card: RuleCard, quantity: number, heading: string | null = null): DeckCards {
  const section = heading === "sideboard" ? "sideboard" : sectionFor(card.type);
  if (!section) return { ...deck, legend_id: card.id };
  return {
    ...deck,
    champion_id: heading === "champion" && card.supertypes.includes("Champion") ? card.id : deck.champion_id,
    entries: changeEntry(deck.entries, { section, card_id: card.id, printing_id: null }, quantity),
  };
}

/** What the rules need of a card. */
export interface RuleCard {
  id: string;
  name: string;
  type: string;
  supertypes: string[];
  domains: string[];
  tags: string[];
  placeholder: boolean;
}

// Only rules with a source (#169). Copy, rune, battlefield and sideboard limits wait until
// Riot's current official rules confirm them, each with its rule number.
const SOURCE = "Riftbound Core Rules, 2025-06-02";
export const MIN_MAIN_DECK = 40;

/** A Champion unit of the Legend's champion. */
export const championOf = (legend: RuleCard, card: RuleCard) =>
  card.supertypes.includes("Champion") && card.tags.some((t) => legend.tags.includes(t));

/** The rules a deck breaks, as warnings only: a deck is saved whatever they say. */
export function deckWarnings(
  deck: { legend_id: string | null; champion_id: string | null },
  entries: Entry[],
  cards: Map<string, RuleCard>,
): { warnings: string[]; placeholder: boolean } {
  const legend = deck.legend_id ? cards.get(deck.legend_id) : undefined;
  const champion = deck.champion_id ? cards.get(deck.champion_id) : undefined;
  const used = entries.flatMap((e) => cards.get(e.card_id) ?? []);
  const main = entries.filter((e) => e.section === "main").reduce((n, e) => n + e.quantity, 0);
  const warnings: string[] = [];
  if (main < MIN_MAIN_DECK) warnings.push(`The main deck has ${main} cards; it needs at least ${MIN_MAIN_DECK} (${SOURCE}).`);
  if (!legend) warnings.push("No Legend yet: it sets the deck's domains and its Chosen Champion.");
  if (!champion) warnings.push(`No Chosen Champion: the main deck includes one, matching the Legend (${SOURCE}).`);
  else {
    if (legend && !championOf(legend, champion))
      warnings.push(`${champion.name} is not a champion of the Legend, ${legend.name} (${SOURCE}).`);
    if (!entries.some((e) => e.section === "main" && e.card_id === champion.id))
      warnings.push(`${champion.name} is the Chosen Champion but not in the main deck (${SOURCE}).`);
  }
  if (legend) {
    const outside = [...new Set(used.filter((c) => c.domains.some((d) => !legend.domains.includes(d))).map((c) => c.name))];
    if (outside.length)
      warnings.push(`Outside the Legend's domains (${legend.domains.join(", ") || "none"}): ${outside.join(", ")} (${SOURCE}).`);
  }
  const placeholder = [legend, champion, ...used].some((c) => c?.placeholder);
  return { warnings, placeholder };
}
