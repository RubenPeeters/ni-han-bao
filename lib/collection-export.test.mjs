import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCard } from "../bot/src/card-match.ts";
import { parseCollectionCsv } from "./collection-import.ts";
import { collectionCsv, collectionDeckList } from "./collection-export.ts";
import { parseDeckList } from "./decks.ts";

const card = (id, name, type, tags = []) => ({ id, name, type, tags, supertypes: [], domains: [] });
const CARDS = [
  card("c-ahri", "Nine-Tailed Fox", "Legend", ["Ahri"]),
  card("c-ahri-unit", "Ahri, Alluring", "Unit", ["Ahri"]),
  card("c-kaisa", 'Kai\'Sa, "Daughter"', "Unit"),
  card("c-bolt", "Firestorm", "Spell"),
  card("c-rune", "Fury Rune", "Rune"),
  card("c-field", "Grove of the God-Willow", "Battlefield"),
];
const printing = (id, card_id, set_code = "OGN", rarity = "common") => ({ id, card_id, set_code, rarity });
const PRINTINGS = [
  printing("ogn-001", "c-ahri", "OGN", "epic"),
  printing("ogn-002", "c-ahri-unit"),
  printing("ogn-003", "c-kaisa", "OGN", "rare"),
  printing("ogn-004", "c-bolt"),
  printing("ogs-004", "c-bolt", "OGS"),
  printing("ogn-005", "c-rune"),
  printing("ogn-006", "c-field"),
];
const cards = new Map(CARDS.map((c) => [c.id, c]));
const printings = new Map(PRINTINGS.map((p) => [p.id, p]));
const ROWS = [
  { printing_id: "ogn-004", quantity: 2 }, // normal NM en
  { printing_id: "ogn-004", quantity: 1 }, // foil LP fr
  { printing_id: "ogs-004", quantity: 3 },
  { printing_id: "ogn-001", quantity: 1 },
  { printing_id: "ogn-002", quantity: 2 },
  { printing_id: "ogn-003", quantity: 1 },
  { printing_id: "ogn-005", quantity: 7 },
  { printing_id: "ogn-005", quantity: 5 },
  { printing_id: "ogn-006", quantity: 1 },
];

test("the deck list sums every printing, finish, condition and language, under deckText()'s headings", () => {
  assert.equal(
    collectionDeckList(ROWS, printings, cards),
    [
      "Legend:",
      "1 Ahri, Nine-Tailed Fox",
      "",
      "Main deck:",
      "2 Ahri, Alluring",
      "6 Firestorm",
      '1 Kai\'Sa, "Daughter"',
      "",
      "Runes:",
      "12 Fury Rune",
      "",
      "Battlefields:",
      "1 Grove of the God-Willow",
    ].join("\n"),
  );
  assert.equal(collectionDeckList([], printings, cards), "");
});

test("the deck list pasted back resolves every line to the same copies", () => {
  const catalogue = { cards: CARDS, printings: [] };
  const back = new Map();
  for (const line of parseDeckList(collectionDeckList(ROWS, printings, cards))) {
    const r = resolveCard(catalogue, line.typed);
    assert.ok(r && "card" in r, line.text);
    back.set(r.card.id, line.quantity);
  }
  assert.deepEqual(Object.fromEntries(back), { "c-ahri": 1, "c-ahri-unit": 2, "c-kaisa": 1, "c-bolt": 6, "c-rune": 12, "c-field": 1 });
});

test("the CSV has one quoted row per printing, quotes doubled", () => {
  const csv = collectionCsv(ROWS, printings, cards);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "card_id,name,set_code,type,rarity,quantity,want_quantity");
  assert.equal(lines.length, 9);
  assert.equal(lines[3], '"ogn-003","Kai\'Sa, ""Daughter""","OGN","Unit","rare","1","0"');
  assert.equal(lines[4], '"ogn-004","Firestorm","OGN","Spell","common","3","0"');
  assert.equal(lines.at(-1), "");
});

test("the CSV imported back gives the same copies per printing", () => {
  const { matched, unknown, invalid } = parseCollectionCsv(collectionCsv(ROWS, printings, cards), (id) => printings.has(id));
  assert.deepEqual(unknown, []);
  assert.deepEqual(invalid, []);
  assert.deepEqual(
    Object.fromEntries(matched.map((r) => [r.printing_id, [r.quantity, r.want]])),
    { "ogn-001": [1, 0], "ogn-002": [2, 0], "ogn-003": [1, 0], "ogn-004": [3, 0], "ogs-004": [3, 0], "ogn-005": [12, 0], "ogn-006": [1, 0] },
  );
  assert.equal(matched.find((r) => r.printing_id === "ogn-003").name, 'Kai\'Sa, "Daughter"');
});
