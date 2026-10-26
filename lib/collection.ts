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

/**
 * The printing a Cards tile shows and steps (#273): the typed number's hit, else the first in
 * collector order; with a set picked, only that set's printings count.
 */
export function tilePrinting<P extends { set_code: string }>(printings: P[], set: string, hit: (p: P) => boolean) {
  const inSet = set ? printings.filter((p) => p.set_code === set) : printings;
  return inSet.find(hit) ?? inSet[0];
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

/** How the Cards grid orders its tiles (#275). */
export type Sort = "set" | "name" | "cost" | "rarity" | "owned";

/** A tile to sort: its card, the printing it shows (`tilePrinting`), and the copies owned over all printings. */
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
