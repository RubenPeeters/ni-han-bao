import { describe, expect, it } from "vitest";
import type { Card } from "./card-match.js";
import { missingCards } from "./deck-match.js";
import { deckEmbed } from "./decks.js";

describe("missingCards", () => {
  it("pinned entries take their printing first, a copy counts once, languages filter", () => {
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
    expect(any.rows.map((r) => [r.section, r.card_id, r.owned])).toEqual([
      ["legend", "l", 1],
      ["main", "a", 2],
      ["sideboard", "a", 2],
      ["main", "b", 0],
    ]);
    expect(any.missing).toBe(2);
    const english = missingCards({ ...deck, allow_other_languages: false }, entries, owned);
    expect(english.rows.map((r) => r.owned)).toEqual([1, 0, 2, 0]);
    expect(english.missing).toBe(4);
    expect(missingCards({ ...deck, legend_id: null }, [], owned).missing).toBe(0);
  });
});

const card = (id: string, name: string, extra: Partial<Card> = {}): Card => ({
  id, name, type: "Unit", supertypes: [], domains: [], energy: null, might: null, tags: [], rules_text: null, placeholder: false, ...extra,
});

describe("deckEmbed", () => {
  const cards = [card("l", "Nine-Tailed Fox", { type: "Legend", tags: ["Ahri"] }), card("a", "Ahri, Alluring"), card("b", "B_ad"), card("r", "Rune")];
  const deck = { id: "d1", name: "Foxy", legend_id: "l", champion_id: "a", visibility: "servers", language: "en", allow_other_languages: true };

  it("counts each card once per section, names the legend and champion, and links the page", () => {
    const embed = deckEmbed(
      deck,
      [
        { section: "main", card_id: "b", printing_id: null, quantity: 2 },
        { section: "main", card_id: "a", printing_id: null, quantity: 1 },
        { section: "main", card_id: "a", printing_id: "a1", quantity: 2 },
        { section: "runes", card_id: "r", printing_id: null, quantity: 12 },
      ],
      { cards },
      "Anna",
      3,
      "https://site.test/",
    );
    expect(embed.url).toBe("https://site.test/decks/d1");
    expect(embed.description).toBe("Legend: Ahri, Nine-Tailed Fox\nChosen Champion: Ahri, Alluring");
    expect(embed.fields).toEqual([
      { name: "Main deck (5)", value: "3 Ahri, Alluring\n2 B\\_ad" },
      { name: "Runes (12)", value: "12 Rune" },
    ]);
    expect(embed.footer?.text).toBe("Anna is missing 3 cards");
  });

  it("cuts a long section to Discord's field limit and says how many more", () => {
    const many = Array.from({ length: 80 }, (_, i) => card(`c${i}`, `A card with a long enough name ${String(i).padStart(2, "0")}`));
    const embed = deckEmbed({ ...deck, legend_id: null, champion_id: null }, many.map((c) => ({ section: "main", card_id: c.id, printing_id: null, quantity: 1 })), { cards: many }, "Anna", 0, null);
    const value = embed.fields![0].value;
    expect(value.length).toBeLessThanOrEqual(1024);
    expect(value).toMatch(/\n…and \d+ more$/);
    expect(embed.url).toBeUndefined();
    expect(embed.description).toBe("Legend: none yet\nChosen Champion: none yet");
    expect(embed.footer?.text).toBe("Anna owns every card");
  });
});
