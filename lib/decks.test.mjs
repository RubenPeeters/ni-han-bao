import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCard } from "../bot/src/card-match.ts";
import { addCard, allPages, changeEntry, deckChanges, deckText, deckWarnings, parseDeckList, replaceEntry, sectionFor, withoutLine } from "./decks.ts";

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

test("changes between two versions: counts per card, pins, Legend and champion", () => {
  const e = (section, card_id, quantity, printing_id = null) => ({ section, card_id, printing_id, quantity });
  const from = { legend_id: "L1", champion_id: "c", entries: [e("main", "a", 3), e("main", "b", 1), e("main", "c", 2), e("runes", "r", 6)] };
  const to = {
    legend_id: "L2",
    champion_id: "c",
    // a: 3 → 5; b gone; c: same 2, one now pinned; r unchanged; s new in the sideboard.
    entries: [e("main", "a", 5), e("main", "c", 1), e("main", "c", 1, "C-1"), e("runes", "r", 6), e("sideboard", "s", 1)],
  };
  assert.deepEqual(deckChanges(from, to), [
    { section: "legend", card_id: "L1", delta: -1, pins: null },
    { section: "legend", card_id: "L2", delta: 1, pins: null },
    { section: "main", card_id: "a", delta: 2, pins: null },
    { section: "main", card_id: "b", delta: -1, pins: null },
    { section: "main", card_id: "c", delta: 0, pins: { from: [], to: [{ printing_id: "C-1", quantity: 1 }] } },
    { section: "sideboard", card_id: "s", delta: 1, pins: null },
  ]);
  assert.deepEqual(deckChanges(to, to), []);
});

test("copy as text: a list the paste import reads back as the same deck, pins aside", () => {
  const card = (id, name, type, extra = {}) => ({ id, name, type, supertypes: [], domains: [], tags: [], placeholder: false, ...extra });
  const cards = [
    card("l", "Nine-Tailed Fox", "Legend", { tags: ["Ahri"] }),
    card("a", "Ahri, Alluring", "Unit", { supertypes: ["Champion"], tags: ["Ahri"] }),
    card("b", "Blast", "Spell"),
    card("r", "Fury Rune", "Rune"),
    card("f", "Field", "Battlefield"),
  ];
  const deck = {
    legend_id: "l",
    champion_id: "a",
    entries: [
      { section: "main", card_id: "a", printing_id: null, quantity: 1 },
      { section: "main", card_id: "a", printing_id: "a1", quantity: 2 },
      { section: "main", card_id: "b", printing_id: null, quantity: 3 },
      { section: "runes", card_id: "r", printing_id: null, quantity: 12 },
      { section: "battlefields", card_id: "f", printing_id: null, quantity: 1 },
      { section: "sideboard", card_id: "b", printing_id: null, quantity: 2 },
    ],
  };
  const text = deckText(deck, new Map(cards.map((c) => [c.id, c])));
  assert.equal(
    text,
    "Legend:\n1 Ahri, Nine-Tailed Fox\n\nChampion:\n3 Ahri, Alluring\n\nMain deck:\n3 Blast\n\nRunes:\n12 Fury Rune\n\nBattlefields:\n1 Field\n\nSideboard:\n2 Blast",
  );
  const catalogue = { cards, printings: [] };
  let back = { legend_id: null, champion_id: null, entries: [] };
  for (const line of parseDeckList(text)) {
    const r = resolveCard(catalogue, line.typed);
    back = addCard(back, r.card, line.quantity, line.heading);
  }
  const key = (es) => es.map((e) => `${e.section} ${e.card_id} ${e.quantity}`).toSorted();
  assert.equal(back.legend_id, "l");
  assert.equal(back.champion_id, "a");
  assert.deepEqual(key(back.entries), key([{ section: "main", card_id: "a", quantity: 3 }, ...deck.entries.filter((e) => e.card_id !== "a")]));
});
