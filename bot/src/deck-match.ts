// What a member is missing of a deck (#175): for the deck pages and /deck share. No imports,
// so the site imports it from here as it is.

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
  deck: { legend_id: string | null; language: string; allow_other_languages: boolean },
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
    ...(deck.legend_id ? [{ section: "legend" as const, card_id: deck.legend_id, printing_id: null, quantity: 1 }] : []),
    ...entries,
  ];
  const got = needs.map((n) => (n.printing_id ? take(n.printing_id, n.quantity) : 0));
  needs.forEach((n, i) => {
    if (!n.printing_id) got[i] = (byCard.get(n.card_id) ?? []).reduce((sum, p) => sum + take(p, n.quantity - sum), 0);
  });
  const rows = needs.map((n, i) => ({ ...n, owned: got[i] }));
  return { rows, missing: rows.reduce((sum, r) => sum + r.quantity - r.owned, 0) };
}
