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
  /** Which shared deck, numbered per card; null: the dedicated decks added up, and the target. */
  deck: number | null;
  /** What the decks need. */
  decks: number;
  /** The hand-set target, if any. */
  manual: number | null;
  copies: { printing_id: string; language: string; quantity: number }[];
}

export interface Wanted extends Omit<WishRow, "copies" | "deck"> {
  /** What the decks need: the dedicated ones added up, plus the largest shared one. */
  decks: number;
  wanted: number;
}

interface Need {
  printing_id: string | null;
  language: string | null;
  quantity: number;
}
/** A copy; null printing or language only for one still to get, which then fits only needs that take any. */
type Copy = Need;

const fits = (c: Copy, n: Need) => (!n.printing_id || c.printing_id === n.printing_id) && (!n.language || c.language === n.language);
const pickiness = (n: Need) => (n.printing_id ? 0 : 2) + (n.language ? 0 : 1);

/**
 * How many of each need the copies of one card leave short, a copy counting once: a maximum
 * matching, so a copy an earlier need took moves to another when a later need can only use it.
 * The pickiest needs are matched first, so the short ones are those any copy fits.
 */
function shortOf(needs: Need[], copies: Copy[]): number[] {
  const left = copies.map((c) => c.quantity);
  const used = needs.map(() => copies.map(() => 0));
  // One more copy for need i, freeing one from another need that can take a different copy.
  const take = (i: number, seen: Set<number>): boolean =>
    copies.some((c, j) => {
      if (seen.has(j) || !fits(c, needs[i])) return false;
      seen.add(j);
      if (!left[j] && !needs.some((_, k) => used[k][j] > 0 && take(k, seen) && used[k][j]--)) return false;
      if (left[j]) left[j]--;
      used[i][j]++;
      return true;
    });
  const short = needs.map((n) => n.quantity);
  for (const i of [...needs.keys()].toSorted((a, b) => pickiness(needs[a]) - pickiness(needs[b]))) {
    while (short[i] && take(i, new Set())) short[i]--;
  }
  return short;
}

/**
 * What is still wanted of each card, pin and language: max(target, decks) minus what is owned, a
 * copy counting once. Dedicated decks stay built, so every shared deck must be buildable beside
 * them; the decks take the owned copies first. The targets then count those copies and the ones
 * the decks still want, so a target is a total, never on top of the decks.
 */
export function wishlist(rows: WishRow[]): Wanted[] {
  const keyOf = (card: string, n: Omit<Need, "quantity">) => `${card}|${n.printing_id}|${n.language}`;
  const out = new Map<string, Wanted>();
  for (const { card_id, printing_id, language } of rows) {
    const key = keyOf(card_id, { printing_id, language });
    if (out.has(key)) continue;
    const same = rows.filter((r) => keyOf(r.card_id, r) === key);
    const decks =
      same.reduce((n, r) => n + (r.deck === null ? r.decks : 0), 0) +
      Math.max(0, ...same.flatMap((r) => (r.deck === null ? [] : [r.decks])));
    out.set(key, { card_id, printing_id, language, decks, manual: same.find((r) => r.manual)?.manual ?? null, wanted: 0 });
  }
  for (const card of new Set(rows.map((r) => r.card_id))) {
    const mine = rows.filter((r) => r.card_id === card);
    const want = (n: Need, q: number) => (out.get(keyOf(card, n))!.wanted += q);
    const asNeed = (r: WishRow, quantity: number): Need => ({ printing_id: r.printing_id, language: r.language, quantity });
    const dedicated = mine.filter((r) => r.deck === null && r.decks > 0).map((r) => asNeed(r, r.decks));
    const shared = [...new Set(mine.flatMap((r) => (r.deck === null ? [] : [r.deck])))].map((d) =>
      mine.filter((r) => r.deck === d).map((r) => asNeed(r, r.decks)),
    );
    // Each shared deck beside the dedicated ones, from the owned copies and those already to get.
    // shortcut: the pickiest shared deck buys first, so decks pinning different things (one a
    // printing, one a language) may want two copies where one fitting both would do; choose the
    // copies to get by matching too if that shows up.
    const owned: Copy[] = mine[0].copies;
    const toGet: Copy[] = [];
    const avg = (s: Need[]) => s.reduce((n, x) => n + pickiness(x) * x.quantity, 0) / s.reduce((n, x) => n + x.quantity, 0);
    for (const deck of shared.length ? shared.toSorted((a, b) => avg(a) - avg(b)) : [[]]) {
      const needs = [...dedicated, ...deck];
      shortOf(needs, [...owned, ...toGet]).forEach((q, i) => {
        if (q) toGet.push({ ...needs[i], quantity: q });
        want(needs[i], q);
      });
    }
    const targets = mine.filter((r) => r.manual).map((r) => asNeed(r, r.manual!));
    shortOf(targets, [...owned, ...toGet]).forEach((q, i) => want(targets[i], q));
  }
  return [...out.values()];
}
