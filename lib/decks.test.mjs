import assert from "node:assert/strict";
import { test } from "node:test";
import { addCard, allPages, changeEntry, deckText, deckWarnings, parseDeckList, replaceEntry, sectionFor, withoutLine } from "./decks.ts";

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
  assert.match(warnings[0], /has 3 cards; it needs at least 40 \(Riftbound Core Rules 2026-10-09, rule 103\.3\)/);
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

test("a picked line leaves the paste box, so pasting again does not add it twice", () => {
  let box = "Main deck:\n3 Ahri\n2 Teemo";
  box = withoutLine(box, "3 Ahri");
  assert.deepEqual(parseDeckList(box).map((l) => l.text), ["2 Teemo"]);
  assert.equal(parseDeckList(box)[0].heading, "maindeck");
  box = withoutLine(box, "2 Teemo");
  assert.deepEqual(parseDeckList(box), []);
  assert.equal(withoutLine("1 Ahri", "2 Ahri"), "1 Ahri");
});

test("allPages reads past the first page and stops on a short one", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => i);
  const asked = [];
  const page = async (from, to) => (asked.push([from, to]), { data: rows.slice(from, to + 1), error: null });
  assert.deepEqual(await allPages(page, 2), { data: rows, error: null });
  assert.deepEqual(asked, [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(await allPages(async () => ({ data: null, error: "down" }), 2), { data: null, error: "down" });
});

test("copy as text reads back into the same deck, printings aside", () => {
  const deck = {
    legend_id: "legend",
    champion_id: "ahri",
    entries: [
      { section: "main", card_id: "ahri", printing_id: "ahri-1", quantity: 1 },
      { section: "main", card_id: "ahri", printing_id: null, quantity: 2 },
      { section: "main", card_id: "spell", printing_id: null, quantity: 3 },
      { section: "sideboard", card_id: "spell", printing_id: null, quantity: 1 },
    ],
  };
  const text = deckText(deck, (id) => cards.get(id).name);
  assert.equal(text, "Legend:\n1 legend\nChampion:\n3 ahri\nMain deck:\n3 spell\nSideboard:\n1 spell");
  const byName = new Map([...cards.values()].map((c) => [c.name, c]));
  const back = parseDeckList(text).reduce((d, l) => addCard(d, byName.get(l.typed), l.quantity, l.heading), { legend_id: null, champion_id: null, entries: [] });
  assert.deepEqual(back, {
    legend_id: "legend",
    champion_id: "ahri",
    entries: [
      { section: "main", card_id: "ahri", printing_id: null, quantity: 3 },
      { section: "main", card_id: "spell", printing_id: null, quantity: 3 },
      { section: "sideboard", card_id: "spell", printing_id: null, quantity: 1 },
    ],
  });
  // A Chosen Champion not in the main deck stays the champion and adds no copy.
  const away = { ...deck, entries: deck.entries.slice(2) };
  const again = parseDeckList(deckText(away, (id) => cards.get(id).name)).reduce((d, l) => addCard(d, byName.get(l.typed), l.quantity, l.heading), { legend_id: null, champion_id: null, entries: [] });
  assert.deepEqual(again, { legend_id: "legend", champion_id: "ahri", entries: away.entries });
});
