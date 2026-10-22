// What a member is missing of a deck (#175), the deck as text and its rules check (#225): for the
// deck pages and /deck share. No imports, so the site imports it from here as it is.

/** A deck entry as riftbound_deck_cards stores it. */
export interface DeckEntry {
  section: string;
  card_id: string;
  /** Pinned: only this printing satisfies the entry. */
  printing_id: string | null;
  quantity: number;
}

/** Copies the viewer owns, as riftbound_collection counts them (a lent copy is still theirs). */
export interface OwnedCopy {
  card_id: string;
  printing_id: string;
  language: string;
  quantity: number;
}

/** An entry, or the Legend in section "legend", with how many of it the viewer owns. */
export interface Owning extends DeckEntry {
  owned: number;
}

/**
 * What the viewer owns of each card the deck needs (its Legend first, then the entries) and how
 * many are missing in all. A copy counts once across entries: pinned entries take their printing
 * first, unpinned ones any printing left. With other languages off, only the deck's language counts.
 */
export function missingCards(
  deck: { legend_id: string | null; legend_printing_id: string | null; language: string; allow_other_languages: boolean },
  entries: DeckEntry[],
  owned: OwnedCopy[],
): { rows: Owning[]; missing: number } {
  const left = new Map<string, number>();
  const byCard = new Map<string, string[]>();
  for (const o of owned) {
    if (!deck.allow_other_languages && o.language !== deck.language) continue;
    if (!left.has(o.printing_id)) byCard.set(o.card_id, [...(byCard.get(o.card_id) ?? []), o.printing_id]);
    left.set(o.printing_id, (left.get(o.printing_id) ?? 0) + o.quantity);
  }
  const take = (printing: string, want: number) => {
    const n = Math.min(want, left.get(printing) ?? 0);
    left.set(printing, (left.get(printing) ?? 0) - n);
    return n;
  };
  const needs: Omit<Owning, "owned">[] = [
    ...(deck.legend_id ? [{ section: "legend" as const, card_id: deck.legend_id, printing_id: deck.legend_printing_id, quantity: 1 }] : []),
    ...entries,
  ];
  const got = needs.map((n) => (n.printing_id ? take(n.printing_id, n.quantity) : 0));
  needs.forEach((n, i) => {
    if (!n.printing_id) got[i] = (byCard.get(n.card_id) ?? []).reduce((sum, p) => sum + take(p, n.quantity - sum), 0);
  });
  const rows = needs.map((n, i) => ({ ...n, owned: got[i] }));
  return { rows, missing: rows.reduce((sum, r) => sum + r.quantity - r.owned, 0) };
}

/** A deck's sections, in the order its list reads. */
export const DECK_SECTIONS = [
  { value: "main", label: "Main deck" },
  { value: "runes", label: "Runes" },
  { value: "battlefields", label: "Battlefields" },
  { value: "sideboard", label: "Sideboard" },
] as const;

/**
 * The deck as a list parseDeckList() reads back: "3 Card Name" lines under headings, a card once
 * per section. The Chosen Champion's main deck copies go under "Champion:", which makes it the
 * Chosen Champion again. Pinned printings are not kept: a list names cards.
 */
export function deckText(
  deck: { legend_id: string | null; champion_id: string | null; entries: DeckEntry[] },
   cards: Map<string, Pick<RuleCard, "name" | "tags">>,
): string {
  const name = (id: string) => cards.get(id)?.name ?? id;
  const count = (section: string, id: string) => deck.entries.filter((e) => e.section === section && e.card_id === id).reduce((n, e) => n + e.quantity, 0);
  const legend = deck.legend_id && cards.get(deck.legend_id);
  const blocks: [string, string[]][] = [
    // A legend by champion and epithet, as resolveCard() takes it: the epithet alone may be another card's name.
    ["Legend", deck.legend_id ? [`1 ${legend ? [...legend.tags.slice(0, 1), legend.name].join(", ") : deck.legend_id}`] : []],
    ["Champion", deck.champion_id ? [`${count("main", deck.champion_id) || 1} ${name(deck.champion_id)}`] : []],
    ...DECK_SECTIONS.map(({ value, label }): [string, string[]] => [
      label,
      [...new Set(deck.entries.filter((e) => e.section === value && !(value === "main" && e.card_id === deck.champion_id)).map((e) => e.card_id))]
        .sort((a, b) => name(a).localeCompare(name(b)))
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
  entries: DeckEntry[],
  cards: Map<string, RuleCard>,
): string[] {
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
  return warnings;
}
