// The Cards grid's collection steppers (#150): pure, so the clamping is tested without a browser.

export const FINISHES = ["normal", "foil"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP"] as const;
export type Finish = (typeof FINISHES)[number];
export type Condition = (typeof CONDITIONS)[number];
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
}

export const rowKey = (printing: string, finish: string, condition: string) => `${printing}|${finish}|${condition}`;

export function parseKey(key: string) {
  const [printing_id, finish, condition] = key.split("|");
  return { printing_id, finish: finish as Finish, condition: condition as Condition };
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
 * "I own a playset of this set", as own_riftbound_playset() does it in the database: each
 * printing with fewer than 3 copies is topped up with normal, NM ones.
 */
export function applyPlayset(rows: Map<string, Copies>, printings: string[]): Map<string, Copies> {
  const next = new Map(rows);
  for (const id of printings) {
    let owned = 0;
    for (const [key, row] of rows) if (parseKey(key).printing_id === id) owned += row.quantity;
    if (owned >= PLAYSET) continue;
    const key = rowKey(id, "normal", "NM");
    const row = next.get(key) ?? NONE;
    next.set(key, { ...row, quantity: row.quantity + PLAYSET - owned });
  }
  return next;
}
