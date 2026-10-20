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

/** The paste box once a line is dealt with (its card picked), so pasting again cannot add it twice. */
export function withoutLine(text: string, line: string): string {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === line);
  return i < 0 ? text : [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
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

/**
 * The deck as a list parseDeckList() reads back: "3 Card Name" lines under headings, a card once
 * per section. The Chosen Champion's main deck copies go under "Champion:", which makes it the
 * Chosen Champion again. Pinned printings are not kept: a list names cards.
 */
export function deckText(deck: DeckCards, cards: Map<string, Pick<RuleCard, "name" | "tags">>): string {
  const name = (id: string) => cards.get(id)?.name ?? id;
  const count = (section: Section, id: string) => deck.entries.filter((e) => e.section === section && e.card_id === id).reduce((n, e) => n + e.quantity, 0);
  const legend = deck.legend_id && cards.get(deck.legend_id);
  const blocks: [string, string[]][] = [
    // A legend by champion and epithet, as resolveCard() takes it: the epithet alone may be another card's name.
    ["Legend", deck.legend_id ? [`1 ${legend ? [...legend.tags.slice(0, 1), legend.name].join(", ") : deck.legend_id}`] : []],
    ["Champion", deck.champion_id ? [`${count("main", deck.champion_id) || 1} ${name(deck.champion_id)}`] : []],
    ...SECTIONS.map(({ value, label }): [string, string[]] => [
      label,
      [...new Set(deck.entries.filter((e) => e.section === value && !(value === "main" && e.card_id === deck.champion_id)).map((e) => e.card_id))]
        .toSorted((a, b) => name(a).localeCompare(name(b)))
        .map((id) => `${count(value, id)} ${name(id)}`),
    ]),
  ];
  return blocks
    .filter(([, lines]) => lines.length)
    .map(([heading, lines]) => [`${heading}:`, ...lines].join("\n"))
    .join("\n\n");
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

// Only rules with a source (#169), each cited by its number. Copy, rune, battlefield and
// sideboard limits wait until they are checked against the rules the same way.
const rule = (n: string) => `Riftbound Core Rules 2026-10-09, rule ${n}`;
export const MIN_MAIN_DECK = 40;

/** A Champion unit of the Legend's champion, named "Champion, Epithet": a shared tag such as "Yordle" is no match. */
export const championOf = (legend: RuleCard, card: RuleCard) =>
  card.supertypes.includes("Champion") && legend.tags.includes(card.name.split(", ")[0]);

// Riot's feed gives battlefields, tokens and a few units the domain "Colorless": no domain, so in any deck.
const domainsOf = (card: RuleCard) => card.domains.filter((d) => d !== "Colorless");

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
  if (main < MIN_MAIN_DECK) warnings.push(`The main deck has ${main} cards; it needs at least ${MIN_MAIN_DECK} (${rule("103.3")}).`);
  if (!legend) warnings.push("No Legend yet: it sets the deck's domains and its Chosen Champion.");
  if (!champion) warnings.push(`No Chosen Champion: the main deck includes one, matching the Legend (${rule("103.3.a")}).`);
  else {
    if (legend && !championOf(legend, champion))
      warnings.push(`${champion.name} is not a champion of the Legend, ${legend.name} (${rule("103.3.a.2")}).`);
    if (!entries.some((e) => e.section === "main" && e.card_id === champion.id))
      warnings.push(`${champion.name} is the Chosen Champion but not in the main deck (${rule("103.3.a")}).`);
  }
  if (legend) {
    const outside = [...new Set(used.filter((c) => domainsOf(c).some((d) => !legend.domains.includes(d))).map((c) => c.name))];
    if (outside.length)
      warnings.push(`Outside the Legend's domains (${legend.domains.join(", ") || "none"}): ${outside.join(", ")} (${rule("103.2.b.1")}).`);
  }
  const placeholder = [legend, champion, ...used].some((c) => c?.placeholder);
  return { warnings, placeholder };
}

/** Every row of a query, `size` at a time: PostgREST caps a response at 1000 rows. `page` must order deterministically. */
export async function allPages<T, E>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
  size = 1000,
): Promise<{ data: T[]; error: null } | { data: null; error: E }> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error || !data) return { data: null, error: error as E };
    rows.push(...data);
    if (data.length < size) return { data: rows, error: null };
  }
}

export interface Pin {
  printing_id: string;
  quantity: number;
}

/** One card's change between two versions: copies more or fewer, and its pinned printings if they changed. */
export interface DeckChange {
  section: Section | "legend" | "champion";
  card_id: string;
  delta: number;
  pins: { from: Pin[]; to: Pin[] } | null;
}

const CHANGE_ORDER = ["legend", "champion", ...SECTIONS.map((s) => s.value)];

/** From one version to another, card by card: "+2 X", "−1 Y", and pins moved without a count changing. */
export function deckChanges(from: DeckCards, to: DeckCards): DeckChange[] {
  // The Legend and the Chosen Champion count as one copy each in sections of their own.
  type Row = Omit<Entry, "section"> & { section: DeckChange["section"] };
  const rows = (d: DeckCards): Row[] => [
    ...d.entries,
    ...(d.legend_id ? [{ section: "legend" as const, card_id: d.legend_id, printing_id: null, quantity: 1 }] : []),
    ...(d.champion_id ? [{ section: "champion" as const, card_id: d.champion_id, printing_id: null, quantity: 1 }] : []),
  ];
  const cards = new Map<string, { section: DeckChange["section"]; card_id: string; before: Row[]; after: Row[] }>();
  const add = (e: Row, side: "before" | "after") => {
    const key = `${e.section}|${e.card_id}`;
    if (!cards.has(key)) cards.set(key, { section: e.section, card_id: e.card_id, before: [], after: [] });
    cards.get(key)![side].push(e);
  };
  rows(from).forEach((e) => add(e, "before"));
  rows(to).forEach((e) => add(e, "after"));
  const count = (es: Row[]) => es.reduce((n, e) => n + e.quantity, 0);
  const pins = (es: Row[]): Pin[] =>
    es
      .filter((e) => e.printing_id)
      .map((e) => ({ printing_id: e.printing_id!, quantity: e.quantity }))
      .toSorted((a, b) => a.printing_id.localeCompare(b.printing_id));
  return [...cards.values()]
    .map(({ section, card_id, before, after }) => {
      const [a, b] = [pins(before), pins(after)];
      return { section, card_id, delta: count(after) - count(before), pins: JSON.stringify(a) === JSON.stringify(b) ? null : { from: a, to: b } };
    })
    .filter((c) => c.delta || c.pins)
    .toSorted((a, b) => CHANGE_ORDER.indexOf(a.section) - CHANGE_ORDER.indexOf(b.section));
}
