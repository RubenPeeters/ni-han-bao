import assert from "node:assert/strict";
import { test } from "node:test";
import { addCard, changeEntry, deckWarnings, parseDeckList, replaceEntry, sectionFor } from "./decks.ts";

test("a pasted list: counts, codes, bare names and headings", () => {
  assert.deepEqual(parseDeckList("Legend:\nAhri\n\nMain deck (40):\n3 Quick Thought\n2x OGN-001\nSideboard:\n1 Low Tide\n"), [
    { text: "Ahri", quantity: 1, typed: "Ahri", heading: "legend" },
    { text: "3 Quick Thought", quantity: 3, typed: "Quick Thought", heading: "maindeck" },
    { text: "2x OGN-001", quantity: 2, typed: "OGN-001", heading: "maindeck" },
    { text: "1 Low Tide", quantity: 1, typed: "Low Tide", heading: "sideboard" },
  ]);
  assert.equal(parseDeckList("500 Quick Thought")[0].quantity, 99);
});

test("cards go where their type goes; a legend is the deck's Legend", () => {
  assert.equal(sectionFor("Unit"), "main");
  assert.equal(sectionFor("Rune"), "runes");
  assert.equal(sectionFor("Battlefield"), "battlefields");
  assert.equal(sectionFor("Legend"), null);
});

test("entries merge, never go below one, and move", () => {
  const a = { section: "main", card_id: "a", printing_id: null };
  let entries = changeEntry(changeEntry([], a, 2), a, 1);
  assert.deepEqual(entries, [{ ...a, quantity: 3 }]);
  // A pinned entry is a different one.
  entries = changeEntry(entries, { ...a, printing_id: "p" }, 1);
  assert.equal(entries.length, 2);
  // Unpinning merges it back.
  entries = replaceEntry(entries, entries[1], a);
  assert.deepEqual(entries, [{ ...a, quantity: 4 }]);
  entries = replaceEntry(entries, entries[0], { ...a, section: "sideboard" });
  assert.deepEqual(entries, [{ ...a, section: "sideboard", quantity: 4 }]);
  assert.deepEqual(changeEntry(entries, { ...a, section: "sideboard" }, -9), []);
});

const card = (id, type, domains, tags = [], supertypes = []) => ({ id, name: id, type, domains, tags, supertypes, placeholder: false });
const cards = new Map(
  [
    card("legend", "Legend", ["Fury", "Calm"], ["Ahri"]),
    card("ahri", "Unit", ["Fury"], ["Ahri"], ["Champion"]),
    card("olaf", "Unit", ["Fury"], ["Olaf"], ["Champion"]),
    card("spell", "Spell", ["Calm"]),
    card("chaos", "Spell", ["Chaos"]),
  ].map((c) => [c.id, c]),
);

test("a legal deck has no warnings", () => {
  const entries = [
    { section: "main", card_id: "ahri", printing_id: null, quantity: 1 },
    { section: "main", card_id: "spell", printing_id: null, quantity: 39 },
  ];
  assert.deepEqual(deckWarnings({ legend_id: "legend", champion_id: "ahri" }, entries, cards), { warnings: [], placeholder: false });
});

test("each sourced rule warns, and placeholder data says so", () => {
  const entries = [
    { section: "main", card_id: "spell", printing_id: null, quantity: 3 },
    { section: "sideboard", card_id: "chaos", printing_id: null, quantity: 1 },
  ];
  const { warnings } = deckWarnings({ legend_id: "legend", champion_id: "olaf" }, entries, cards);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /has 3 cards; it needs at least 40 \(Riftbound Core Rules, 2025-06-02\)/);
  assert.match(warnings[1], /olaf is not a champion of the Legend/);
  assert.match(warnings[2], /olaf is the Chosen Champion but not in the main deck/);
  assert.match(warnings[3], /Outside the Legend's domains \(Fury, Calm\): chaos/);
  assert.equal(deckWarnings({ legend_id: null, champion_id: null }, [], cards).warnings.length, 3);
  const placeholder = new Map(cards).set("spell", { ...cards.get("spell"), placeholder: true });
  assert.equal(deckWarnings({ legend_id: "legend", champion_id: "ahri" }, entries, placeholder).placeholder, true);
});

test("added cards: a legend is the Legend, headings pick the sideboard and the champion", () => {
  const empty = { legend_id: null, champion_id: null, entries: [] };
  assert.equal(addCard(empty, cards.get("legend"), 1).legend_id, "legend");
  const champ = addCard(empty, cards.get("ahri"), 1, "champion");
  assert.equal(champ.champion_id, "ahri");
  assert.deepEqual(champ.entries, [{ section: "main", card_id: "ahri", printing_id: null, quantity: 1 }]);
  assert.equal(addCard(empty, cards.get("spell"), 2, "sideboard").entries[0].section, "sideboard");
  assert.equal(addCard(empty, cards.get("spell"), 2, "champion").champion_id, null);
});
