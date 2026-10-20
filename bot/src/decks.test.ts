import { describe, expect, it } from "vitest";
import { deckChoices, deckMessage, missingDeckId, missingText, pickDeck, type SharedDeck } from "./decks.js";
import { placeholderCatalogue } from "./riftbound.js";

const ID = "00000000-0000-4000-8000-0000000d0001";
const decks = [
  { id: ID, name: "Ahri Tempo" },
  { id: "00000000-0000-4000-8000-0000000d0002", name: "Jinx Burn" },
  { id: "00000000-0000-4000-8000-0000000d0003", name: "jinx burn" },
];

describe("/deck share", () => {
  it("suggests and picks only the caller's decks", () => {
    expect(deckChoices(decks, "ahri")).toEqual([{ name: "Ahri Tempo", value: ID }]);
    expect(deckChoices(decks, "")).toHaveLength(3);
    expect(pickDeck(decks, ID)?.name).toBe("Ahri Tempo");
    expect(pickDeck(decks, "ahri tempo")?.id).toBe(ID);
    // Two decks by that name: never guessed.
    expect(pickDeck(decks, "Jinx Burn")).toBeNull();
    expect(pickDeck(decks, "nope")).toBeNull();
  });

  it("reads back only its own button's deck id", () => {
    expect(missingDeckId(`deck-missing:${ID}`)).toBe(ID);
    expect(missingDeckId("deck-missing:'; drop table")).toBeNull();
    expect(missingDeckId("event-going:1")).toBeNull();
  });

  it("posts the legend, the champion, counts per card and the sharer's missing count", () => {
    const catalogue = placeholderCatalogue([{ id: "Ahri", key: "103", name: "Ahri" }]);
    const deck: SharedDeck = {
      id: ID,
      name: "Ahri Tempo",
      legend_id: "placeholder-legend-ahri",
      champion_id: "placeholder-unit-ahri",
      visibility: "servers",
      language: "en",
      allow_other_languages: true,
    };
    const entries = [
      { section: "main", card_id: "placeholder-unit-ahri", printing_id: "PLH-U103", quantity: 1 },
      { section: "main", card_id: "placeholder-unit-ahri", printing_id: null, quantity: 2 },
      { section: "main", card_id: "placeholder-spell-quick-thought", printing_id: null, quantity: 3 },
      { section: "sideboard", card_id: "placeholder-spell-low-tide", printing_id: null, quantity: 1 },
    ];
    const { embeds, components } = deckMessage(deck, entries, catalogue, "Anna", 2, "https://site.example/");
    const [embed] = embeds;
    expect(embed.url).toBe(`https://site.example/decks/${ID}`);
    expect(embed.description).toMatch(/^Legend: Ahri, .+\nChosen Champion: Ahri, /);
    expect(embed.fields).toEqual([
      { name: "Main deck (6)", value: expect.stringMatching(/^3 Ahri, .+\n3 Quick Thought$/), inline: false },
      { name: "Sideboard (1)", value: "1 Low Tide", inline: false },
    ]);
    expect(embed.footer?.text).toBe("Anna is missing 2 cards · Placeholder cards");
    expect(JSON.stringify(components)).toContain(`deck-missing:${ID}`);
  });

  it("cuts a long section at Discord's field limit", () => {
    const cards = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, name: `A rather long card name ${String(i).padStart(2, "0")}` }));
    const catalogue = { cards: cards.map((c) => ({ ...c, type: "Spell", supertypes: [], domains: [], energy: null, might: null, tags: [], rules_text: null, placeholder: false })), printings: [] };
    const deck: SharedDeck = { id: ID, name: "Big", legend_id: null, champion_id: null, visibility: "public", language: "en", allow_other_languages: true };
    const entries = cards.map((c) => ({ section: "main", card_id: c.id, printing_id: null, quantity: 1 }));
    const [field] = deckMessage(deck, entries, catalogue, "Anna", 0, null).embeds[0].fields!;
    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toMatch(/\n…and \d+ more$/);
  });

  it("tells the clicker what they are missing", () => {
    expect(missingText(decks[0], 1, "https://site.example")).toBe(`You are missing 1 card for **Ahri Tempo**. Which ones: https://site.example/decks/${ID}`);
    expect(missingText(decks[0], 0, null)).toBe("You own every card in **Ahri Tempo**.");
  });
});
