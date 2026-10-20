// Riftbound wishlist (#177): pure, so what is still wanted is tested without a database.

/** The database's wishlist_mode values, on decks and as a member's default. */
export const WISHLIST_MODES = [
  { value: "none", label: "Not on my wishlist", hint: "The deck adds nothing to your wishlist." },
  { value: "shared", label: "Shared", hint: "Cards move between decks: your wishlist takes the largest need among them." },
  { value: "dedicated", label: "Dedicated", hint: "The deck stays built: its needs add up with the others'." },
] as const;
export type WishlistMode = (typeof WISHLIST_MODES)[number]["value"];

/** A row of profile_wishlist(): one card, pin and language (null: any), with the owner's copies of the card. */
export interface WishRow {
  card_id: string;
  printing_id: string | null;
  language: string | null;
  /** What the decks need: the dedicated ones added up, plus the largest shared one. */
  decks: number;
  /** The hand-set target, if any. */
  manual: number | null;
  copies: { printing_id: string; language: string; quantity: number }[];
}

export interface Wanted extends Omit<WishRow, "copies"> {
  wanted: number;
}

interface Need {
  card_id: string;
  printing_id: string | null;
  language: string | null;
  quantity: number;
}
/** A copy; null printing or language only for one still to get, which then fits only needs that take any. */
type Copy = Need;

const fits = (c: Copy, n: Need) =>
  c.card_id === n.card_id && (!n.printing_id || c.printing_id === n.printing_id) && (!n.language || c.language === n.language);
// The pickiest needs take their copies first, so a copy any need takes is not one a pin needed.
const pickiness = (n: Need) => (n.printing_id ? 0 : 2) + (n.language ? 0 : 1);

/** How many of each need the copies leave short, a copy counting once. */
function shortOf(needs: Need[], copies: Copy[]): number[] {
  const left = copies.map((c) => c.quantity);
  const short = needs.map((n) => n.quantity);
  for (const i of [...needs.keys()].toSorted((a, b) => pickiness(needs[a]) - pickiness(needs[b]))) {
    copies.forEach((c, j) => {
      if (!short[i] || !fits(c, needs[i])) return;
      const n = Math.min(short[i], left[j]);
      left[j] -= n;
      short[i] -= n;
    });
  }
  return short;
}

/**
 * What is still wanted of each row: max(target, decks) minus what is owned, a copy counting once.
 * The decks take the owned copies first; the targets then count those copies and the ones the
 * decks still want, so a target is a total, never on top of the decks.
 */
export function wishlist(rows: WishRow[]): Wanted[] {
  // Every row of a card carries the same copies: take them once per card.
  const owned: Copy[] = [...new Map(rows.map((r) => [r.card_id, r.copies]))].flatMap(([card_id, copies]) =>
    copies.map((c) => ({ ...c, card_id })),
  );
  const key = ({ card_id, printing_id, language }: WishRow) => ({ card_id, printing_id, language });
  const forDecks = rows.map((r) => ({ ...key(r), quantity: r.decks }));
  const fromDecks = shortOf(forDecks, owned);
  const toGet = forDecks.map((n, i) => ({ ...n, quantity: fromDecks[i] }));
  const fromTargets = shortOf(rows.map((r) => ({ ...key(r), quantity: r.manual ?? 0 })), [...owned, ...toGet]);
  return rows.map(({ card_id, printing_id, language, decks, manual }, i) => ({
    card_id,
    printing_id,
    language,
    decks,
    manual,
    wanted: fromDecks[i] + fromTargets[i],
  }));
}
