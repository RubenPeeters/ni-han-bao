/** One riftbound_collection row of the visitor's, as the steppers edit it. */
export interface Copy {
  printing: string;
  finish: string;
  condition: string;
  quantity: number;
  for_trade: number;
  /** Null: the owner's default. */
  lendable: number | null;
}

export const FINISHES = ["normal", "foil"];
export const CONDITIONS = ["NM", "LP", "MP", "HP"];
const MAX = 999;

export const copyKey = (c: Pick<Copy, "printing" | "finish" | "condition">) => `${c.printing}|${c.finish}|${c.condition}`;

/** Copies on offer, as riftbound_available() counts them (decks aside). */
export const available = (c: Copy, lends: boolean, lendAll: boolean) =>
  lends ? (c.lendable ?? (lendAll ? c.quantity : 0)) : 0;

/**
 * One tap on a stepper. Trade and lend counts never exceed the copies; a card lent in full
 * stays lent in full when a copy is added, so "lend all" is one tap and not one per copy.
 */
export function step(c: Copy, field: "quantity" | "for_trade" | "lendable", delta: number, lendAll: boolean): Copy {
  if (field === "quantity") {
    const quantity = Math.min(MAX, Math.max(0, c.quantity + delta));
    const allLent = c.lendable !== null && c.lendable === c.quantity;
    const lendable = c.lendable === null ? null : allLent ? quantity : Math.min(c.lendable, quantity);
    return { ...c, quantity, for_trade: Math.min(c.for_trade, quantity), lendable };
  }
  const from = field === "lendable" ? (c.lendable ?? (lendAll ? c.quantity : 0)) : c[field];
  return { ...c, [field]: Math.min(c.quantity, Math.max(0, from + delta)) };
}

/** Retries back off up to half a minute: a flaky connection gets every tap through eventually. */
export const retryDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

/**
 * Errors the database will give again however often it is asked (forgotten user, a value it
 * rejects, not logged in with Discord); everything else, a dropped connection included, is retried.
 */
export const isPermanent = (error: { code?: string }) => /^(P0001|22|23|42)/.test(error.code ?? "");
