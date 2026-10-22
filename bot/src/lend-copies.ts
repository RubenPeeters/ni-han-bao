// Which copies a loan takes (#172), for /lend and the deck page's Lend this deck (#179).
// Without discord.js, so the website imports it too.

import type { Card, Catalogue } from "./card-match.js";

export interface Wanted {
  card: Card;
  count: number;
  /** Only copies of this printing: a deck's pinned Legend. */
  printing?: string | null;
}

/** A row of riftbound_lend_options(): one of the lender's collection rows of a wanted card. */
export interface CopyRow {
  card_id: string;
  printing_id: string;
  finish: string;
  condition: string;
  language: string;
  quantity: number;
  /** How many the owner offers to lend (riftbound_lendable()). */
  lendable: number;
  /** How many are out on open loans. */
  lent: number;
  /** Copies of the card (not this row) the lender's decks marked not for lending hold. */
  held: number;
}

export type LoanCard = Pick<CopyRow, "printing_id" | "finish" | "condition" | "language" | "quantity">;

/**
 * Which copies a loan takes: those available to lend first, then the rest of what is in hand
 * (owned and not out on a loan), counted in `unmarked` for a warning. Copies a deck not for
 * lending holds are never available to lend, whatever the per-card counts say. Or why it cannot.
 */
export function pickCopies(rows: CopyRow[], wanted: Wanted[]): { cards: LoanCard[]; unmarked: number } | string {
  const cards: LoanCard[] = [];
  let unmarked = 0;
  for (const { card, count, printing } of wanted) {
    const free = rows
      .filter((r) => r.card_id === card.id && (!printing || r.printing_id === printing))
      .sort((a, b) => `${a.printing_id} ${a.finish} ${a.language} ${a.condition}`.localeCompare(`${b.printing_id} ${b.finish} ${b.language} ${b.condition}`))
      .map((row) => {
        const inHand = Math.max(row.quantity - row.lent, 0);
        // Lent copies count against the lendable ones first, as card_lenders() does.
        const marked = Math.min(Math.max(row.lendable - row.lent, 0), inHand);
        return { row, marked, rest: inHand - marked, take: 0 };
      });
    const inHand = free.reduce((n, f) => n + f.marked + f.rest, 0);
    if (inHand < count) {
      return `You have ${inHand ? `only ${inHand}` : "no"} ${card.name}${printing ? " in the deck's printing" : ""} to lend: that counts the copies in your collection (/collection add) that are not out on a loan.`;
    }
    // The held copies are the in-hand ones left after the marked: as riftbound_free_to_lend().
    let markable = Math.max(inHand - (free[0]?.row.held ?? 0), 0);
    for (const f of free) {
      const m = Math.min(f.marked, markable);
      f.rest += f.marked - m;
      f.marked = m;
      markable -= m;
    }
    let left = count;
    for (const pass of ["marked", "rest"] as const) {
      for (const f of free) {
        const n = Math.min(left, f[pass]);
        f.take += n;
        left -= n;
        if (pass === "rest") unmarked += n;
      }
    }
    for (const { row, take } of free) {
      if (take) cards.push({ printing_id: row.printing_id, finish: row.finish, condition: row.condition, language: row.language, quantity: take });
    }
  }
  return { cards, unmarked };
}

/**
 * A deck lent whole: its Legend (in its pinned printing, if any) and every entry, per card.
 * shortcut: the entries' pinned printings and the deck's language are not kept, the loan takes
 * whichever copies the lender has; honour them when someone lends a deck that relies on them.
 */
export function deckWanted(
  catalogue: Pick<Catalogue, "cards">,
  deck: { legend_id: string | null; legend_printing_id?: string | null; entries: { card_id: string; quantity: number }[] },
): Wanted[] | string {
  const counts = new Map<string, number>();
  for (const e of [...(deck.legend_id ? [{ card_id: deck.legend_id, quantity: 1 }] : []), ...deck.entries]) {
    counts.set(e.card_id, (counts.get(e.card_id) ?? 0) + e.quantity);
  }
  if (counts.size === 0) return "That deck has no cards yet.";
  const wanted: Wanted[] = [];
  for (const [id, count] of counts) {
    const card = catalogue.cards.find((c) => c.id === id);
    if (!card) return "That deck has a card that is no longer in the catalogue: save it again first.";
    wanted.push({ card, count, printing: id === deck.legend_id ? deck.legend_printing_id : null });
  }
  return wanted;
}
