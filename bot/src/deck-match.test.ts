import { describe, expect, it } from "vitest";
import { missingCards } from "./deck-match.js";

describe("missingCards", () => {
  it("takes pinned printings first, counts a copy once and filters languages", () => {
    const owned = [
      { card_id: "a", printing_id: "a1", language: "en", quantity: 2 },
      { card_id: "a", printing_id: "a2", language: "fr", quantity: 2 },
      { card_id: "l", printing_id: "l1", language: "en", quantity: 1 },
    ];
    const entries = [
      { section: "main", card_id: "a", printing_id: null, quantity: 3 },
      { section: "sideboard", card_id: "a", printing_id: "a1", quantity: 2 },
      { section: "main", card_id: "b", printing_id: null, quantity: 1 },
    ];
    const deck = { legend_id: "l", language: "en", allow_other_languages: true };
    const any = missingCards(deck, entries, owned);
    expect(any.rows.map((r) => [r.section, r.card_id, r.owned])).toEqual([["legend", "l", 1], ["main", "a", 2], ["sideboard", "a", 2], ["main", "b", 0]]);
    expect(any.missing).toBe(2);
    const english = missingCards({ ...deck, allow_other_languages: false }, entries, owned);
    expect(english.rows.map((r) => r.owned)).toEqual([1, 0, 2, 0]);
    expect(english.missing).toBe(4);
    expect(missingCards({ ...deck, legend_id: null }, [], owned).missing).toBe(0);
  });
});
