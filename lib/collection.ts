// The Cards grid's collection steppers (#150): pure, so the clamping is tested without a browser.

export const FINISHES = ["normal", "foil"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP"] as const;
/** The database's riftbound_language domain, with the names shown for them. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "zh-Hans", name: "Chinese (Simplified)" },
  { code: "fr", name: "French" },
] as const;
export type Finish = (typeof FINISHES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Language = (typeof LANGUAGES)[number]["code"];
export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
/** A language as a chip shows it: "FR", "ZH". */
export const languageCode = (code: string) => code.split("-")[0].toUpperCase();
/** Who has it?'s copies to lend per language, as riftbound_free_to_lend() returns them: "EN 1 · FR 1". */
export const perLanguage = (copies: { language: string; copies: number }[] | number) =>
  // A database not yet migrated still returns the old total: show it rather than take the page down.
  typeof copies === "number" ? `${copies} to lend` : copies.map((c) => `${languageCode(c.language)} ${c.copies}`).join(" · ");
/**
 * Which languages a borrower takes (#298), first match wins: the borrow request's own choice,
 * the deck's language when it takes no other, the member's Settings.
 */
export function borrowLanguages(member: string[], deck?: { language: string; allow_other_languages: boolean } | null, request?: string[] | null) {
  if (request?.length) return request;
  if (deck && !deck.allow_other_languages) return [deck.language];
  return member;
}
/**
 * A lender's copies for Who has it?: those in the borrower's languages as the row's value, the
 * rest folded into "also: FR 1". A database not yet migrated returns a total: all of it matches.
 */
export function borrowCopies(copies: { language: string; copies: number }[] | number, languages: string[]) {
  if (typeof copies === "number") return { value: perLanguage(copies), also: null, matches: copies };
  const match = copies.filter((c) => languages.includes(c.language));
  const other = copies.filter((c) => !languages.includes(c.language));
  return {
    value: match.length ? perLanguage(match) : "-",
    also: other.length ? `also: ${perLanguage(other)}` : null,
    matches: match.reduce((n, c) => n + c.copies, 0),
  };
}
/** A lender's copies to lend in every language, the most a request can ask of them. */
export const totalCopies = (copies: { language: string; copies: number }[] | number) =>
  typeof copies === "number" ? copies : copies.reduce((n, c) => n + c.copies, 0);
/**
 * Ask for all missing (#299): per lender, each missing card they lend, prefilled with as many as
 * they have in the borrower's languages, else in any, never more than is missing. A pinned
 * printing's row asks for its card: requests name cards, the lender picks the copies.
 */
export function askAllMissing<L extends { card_id: string; printing_id: string | null; user_id: string; copies: { language: string; copies: number }[] | number }>(
  missing: { card_id: string; printing_id: string | null; name: string; missing: number }[],
  lenders: L[],
  languages: string[],
) {
  const asks = new Map<string, { lender: L; cards: Map<string, { card_id: string; name: string; count: number; max: number }> }>();
  for (const m of missing) {
    for (const l of lenders.filter((x) => x.card_id === m.card_id && x.printing_id === m.printing_id)) {
      const ask = asks.get(l.user_id) ?? { lender: l, cards: new Map() };
      asks.set(l.user_id, ask);
      const max = totalCopies(l.copies);
      const card = ask.cards.get(m.card_id) ?? { card_id: m.card_id, name: m.name, count: 0, max: 0 };
      card.max = Math.max(card.max, max);
      card.count = Math.min(card.count + Math.min(m.missing, borrowCopies(l.copies, languages).matches || max), card.max);
      ask.cards.set(m.card_id, card);
    }
  }
  return [...asks.values()].map((a) => ({ lender: a.lender, cards: [...a.cards.values()] }));
}
/** Which number a tile's stepper changes. */
export type Mode = "quantity" | "for_trade" | "lendable";

export interface Copies {
  quantity: number;
  for_trade: number;
  /** Null follows the owner's default: all copies with lendAll, else none. */
  lendable: number | null;
}

export interface OwnedRow extends Copies {
  printing_id: string;
  finish: Finish;
  condition: Condition;
  language: Language;
}

export const rowKey = (printing: string, finish: string, condition: string, language: string) =>
  `${printing}|${finish}|${condition}|${language}`;

export function parseKey(key: string) {
  // Keys queued in localStorage before languages (#171) have none: those copies were English.
  const [printing_id, finish, condition, language = "en"] = key.split("|");
  return { printing_id, finish: finish as Finish, condition: condition as Condition, language: language as Language };
}

type Printing = { id: string; set_code: string; collector_code: string; collector_number: number };

/**
 * The printing a Cards tile shows and steps (#273): the typed number's hit, else the first basic
 * one in collector order (#285), else the first; with a set picked, only that set's printings count.
 */
export function tilePrinting<P extends Omit<Printing, "id">>(printings: P[], set: string, hit: (p: P) => boolean) {
  const inSet = set ? printings.filter((p) => p.set_code === set) : printings;
  return inSet.find(hit) ?? inSet.find((p) => isBasicPrinting(p.collector_code, p.collector_number)) ?? inSet[0];
}

/** One tile per card, or one per printing. */
export type View = "card" | "printing";

/**
 * Which tiles the Cards grid shows (#285). `kept` is the card's type, domain and cost filters, which
 * always apply; `named` is the text search, which a printing the typed number `hit`s passes too. `owned` is copies per printing
 * (`ownedByPrinting`); `elsewhere` is how many of a card's copies sit on printings its tile does not step.
 */
export function gridTiles<C extends { printings: Printing[] }, P extends C["printings"][number] = C["printings"][number]>(
  cards: C[],
  { view, set, kept, named, hit, owned }: { view: View; set: string; kept: (c: C) => boolean; named: (c: C) => boolean; hit: (p: P) => boolean; owned: Map<string, number> },
) {
  const copies = (p: Printing) => owned.get(p.id) ?? 0;
  return cards.flatMap((card) => {
    if (!kept(card)) return [];
    const inSet = (set ? card.printings.filter((p) => p.set_code === set) : card.printings) as P[];
    if (view === "printing") {
      return inSet.filter((p) => named(card) || hit(p)).map((printing) => ({ ...card, printing, owned: copies(printing), elsewhere: 0 }));
    }
    if (set && !inSet.length) return [];
    const printing = tilePrinting(card.printings as P[], set, hit);
    if (!named(card) && !(printing && hit(printing))) return [];
    const total = card.printings.reduce((n, p) => n + copies(p), 0);
    return [{ ...card, printing, owned: total, elsewhere: total - (printing ? copies(printing) : 0) }];
  });
}

/** Copies owned per printing, over every finish, condition and language. */
export function ownedByPrinting(rows: Map<string, Copies>): Map<string, number> {
  const owned = new Map<string, number>();
  for (const [key, row] of rows) {
    const { printing_id } = parseKey(key);
    owned.set(printing_id, (owned.get(printing_id) ?? 0) + row.quantity);
  }
  return owned;
}

/** A collection row with its key, as Your copies (#297) edits it. */
export interface KeyedRow extends OwnedRow {
  key: string;
}

/** Every row per printing: language, then finish and condition in their dropdowns' order. */
export function rowsByPrinting(rows: Map<string, Copies>): Map<string, KeyedRow[]> {
  const rank = (r: KeyedRow) => [r.language, FINISHES.indexOf(r.finish), CONDITIONS.indexOf(r.condition)] as const;
  const out = new Map<string, KeyedRow[]>();
  for (const [key, row] of rows) {
    const r = { ...row, ...parseKey(key), key };
    out.set(r.printing_id, [...(out.get(r.printing_id) ?? []), r]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0) || x[1] - y[1] || x[2] - y[2];
    });
  }
  return out;
}

/**
 * What a tile shows of its copies (#297): the rows of `printings` (the tile's printing, or every
 * printing of its card), which Your copies lists, and a chip per language other than the entry
 * language with copies owned: "FR 1".
 */
export function tileCopies(byPrinting: Map<string, KeyedRow[]>, printings: string[], entry: string) {
  const rows = printings.flatMap((p) => byPrinting.get(p) ?? []);
  const per = new Map<string, number>();
  for (const r of rows) if (r.language !== entry && r.quantity > 0) per.set(r.language, (per.get(r.language) ?? 0) + r.quantity);
  const chips = [...per].sort(([a], [b]) => (a < b ? -1 : 1)).map(([language, copies]) => ({ language, copies }));
  return { rows, chips };
}

/** A deck not for lending's hold on one card: its Legend and entries of it, in the deck's language. */
export interface DeckHold {
  name: string;
  language: string;
  copies: number;
}

/**
 * Which rows' copies the decks not for lending hold (#297), for Your copies' "in decks". As
 * heldByLanguage() in bot/src/lend-copies.ts: each deck takes copies in hand (owned, not out on
 * a loan, `lent` per row key) of its own language first, then of the others in alphabetical
 * order; within a language, rows in the order given. `rows` are all of the card's.
 */
export function deckCopies(rows: { key: string; language: string; quantity: number }[], lent: Map<string, number>, decks: DeckHold[]) {
  const free = new Map(rows.map((r) => [r.key, Math.max(r.quantity - (lent.get(r.key) ?? 0), 0)]));
  const held = new Map<string, { name: string; copies: number }[]>();
  const take = (deck: DeckHold, wanted: number, from: typeof rows) => {
    for (const r of from) {
      const n = Math.min(wanted, free.get(r.key)!);
      if (n <= 0) continue;
      free.set(r.key, free.get(r.key)! - n);
      held.set(r.key, [...(held.get(r.key) ?? []), { name: deck.name, copies: n }]);
      wanted -= n;
    }
    return wanted;
  };
  const left = decks.map((d) => take(d, d.copies, rows.filter((r) => r.language === d.language)));
  const others = rows.toSorted((a, b) => (a.language < b.language ? -1 : a.language > b.language ? 1 : 0));
  decks.forEach((d, i) => take(d, left[i], others));
  return held;
}

/** How the Cards grid orders its tiles (#275). */
export type Sort = "set" | "name" | "cost" | "rarity" | "owned";

/** A tile to sort: its card, the printing it shows (`gridTiles`), and the copies it counts as owned. */
export interface Sorted<P> {
  name: string;
  energy: number | null;
  printing: P | undefined;
  owned: number;
}

/**
 * The tiles' order for a sort and direction, set and number breaking ties. A tile without a
 * printing, a card without a cost and an unknown rarity go last either way. `byPrinting` and
 * `rarityRank` come from the bot's card-match, which this file cannot import and still run in tests.
 */
export function cardOrder<P extends { set_code: string; collector_number: number; collector_code: string; rarity: string | null }>(
  sort: Sort,
  descending: boolean,
  { byPrinting, rarityRank }: { byPrinting: (a: P, b: P) => number; rarityRank: (rarity: string | null) => number },
) {
  const dir = descending ? -1 : 1;
  const bySet = (a: Sorted<P>, b: Sorted<P>) => (a.printing && b.printing ? byPrinting(a.printing, b.printing) : 0);
  const unknown = rarityRank(null);
  const rank = (t: Sorted<P>) => rarityRank(t.printing?.rarity ?? null);
  const key: Record<Sort, (a: Sorted<P>, b: Sorted<P>) => number> = {
    set: (a, b) => dir * bySet(a, b),
    name: (a, b) => dir * a.name.localeCompare(b.name),
    cost: (a, b) => Number(a.energy === null) - Number(b.energy === null) || dir * ((a.energy ?? 0) - (b.energy ?? 0)),
    // Rarest has the lowest rank, so ascending (Common first) runs the ranks backwards.
    rarity: (a, b) => Number(rank(a) === unknown) - Number(rank(b) === unknown) || dir * (rank(b) - rank(a)),
    owned: (a, b) => dir * (a.owned - b.owned),
  };
  return (a: Sorted<P>, b: Sorted<P>) => Number(!a.printing) - Number(!b.printing) || key[sort](a, b) || bySet(a, b);
}

export const NONE: Copies = { quantity: 0, for_trade: 0, lendable: null };

/** What the stepper shows for a row: the lendable count as the database would work it out. */
export function shown(row: Copies, mode: Mode, lendAll: boolean): number {
  if (mode === "lendable") return Math.min(row.quantity, row.lendable ?? (lendAll ? row.quantity : 0));
  return row[mode];
}

/** One tap: for trade and to lend never exceed the copies, and fewer copies pull them down. */
export function step(row: Copies, mode: Mode, delta: number, lendAll: boolean): Copies {
  const next = Math.max(0, Math.min(mode === "quantity" ? Infinity : row.quantity, shown(row, mode, lendAll) + delta));
  if (mode === "for_trade") return { ...row, for_trade: next };
  if (mode === "lendable") return { ...row, lendable: next };
  return {
    quantity: next,
    for_trade: Math.min(row.for_trade, next),
    lendable: row.lendable === null ? null : Math.min(row.lendable, next),
  };
}

/** Wait before retry `attempt` (0-based) of a failed save: doubling, at most 30 s. */
export const retryDelay = (attempt: number) => Math.min(30_000, 1_000 * 2 ** attempt);

/** A playset is 3 copies, of any finish or condition. */
export const PLAYSET = 3;

/**
 * A set's normal number (#284): `SET-NNN/TOTAL` with NNN <= TOTAL. Not an alternate art (`023a`),
 * starred (`197*`), overnumbered (`169/166`), SP, token or rune printing. own_riftbound_playset() has the same rule.
 */
export function isBasicPrinting(collector_code: string, collector_number: number) {
  const total = /^[^-]+-\d+\/(\d+)$/.exec(collector_code)?.[1];
  return total !== undefined && collector_number <= Number(total);
}

/**
 * "I own a playset of this set", as own_riftbound_playset() does it in the database: each basic
 * printing with fewer than `copies` (in any language) is topped up with normal, NM ones in `language`.
 */
export function applyPlayset(
  rows: Map<string, Copies>,
  printings: { id: string; collector_code: string; collector_number: number }[],
  language: Language,
  copies = PLAYSET,
): Map<string, Copies> {
  const next = new Map(rows);
  for (const { id } of printings.filter((p) => isBasicPrinting(p.collector_code, p.collector_number))) {
    let owned = 0;
    for (const [key, row] of rows) if (parseKey(key).printing_id === id) owned += row.quantity;
    if (owned >= copies) continue;
    const key = rowKey(id, "normal", "NM", language);
    const row = next.get(key) ?? NONE;
    next.set(key, { ...row, quantity: row.quantity + copies - owned });
  }
  return next;
}
