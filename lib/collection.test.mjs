import assert from "node:assert/strict";
import { test } from "node:test";
import { byPrinting, matchesCode, rarityRank } from "../bot/src/card-match.ts";
import { applyPlayset, cardOrder, isBasicPrinting, NONE, ownedByPrinting, parseKey, retryDelay, rowKey, shown, step, tilePrinting } from "./collection.ts";

test("adding and removing copies, never below 0", () => {
  const one = step(NONE, "quantity", 1, false);
  assert.deepEqual(one, { quantity: 1, for_trade: 0, lendable: null });
  assert.deepEqual(step(step(one, "quantity", -1, false), "quantity", -1, false), NONE);
});

test("for trade and to lend stay within the copies", () => {
  const two = { quantity: 2, for_trade: 0, lendable: null };
  assert.equal(step(step(step(two, "for_trade", 1, false), "for_trade", 1, false), "for_trade", 1, false).for_trade, 2);
  assert.equal(step(two, "lendable", 5, false).lendable, 2);
  // Fewer copies pull for trade and an explicit lend count down with them.
  assert.deepEqual(step({ quantity: 2, for_trade: 2, lendable: 2 }, "quantity", -1, false), {
    quantity: 1,
    for_trade: 1,
    lendable: 1,
  });
});

test("a card without its own lend count follows the default", () => {
  const three = { quantity: 3, for_trade: 0, lendable: null };
  assert.equal(shown(three, "lendable", false), 0);
  assert.equal(shown(three, "lendable", true), 3);
  // Overriding starts from what the default gave.
  assert.equal(step(three, "lendable", -1, true).lendable, 2);
  assert.equal(step(three, "quantity", 1, true).lendable, null);
});

test("keys round-trip and retries back off up to 30 s", () => {
  assert.deepEqual(parseKey(rowKey("PLH-L103", "foil", "LP", "zh-Hans")), {
    printing_id: "PLH-L103",
    finish: "foil",
    condition: "LP",
    language: "zh-Hans",
  });
  // Queued before languages: English.
  assert.equal(parseKey("PLH-L103|foil|LP").language, "en");
  assert.deepEqual([0, 1, 2, 10].map(retryDelay), [1_000, 2_000, 4_000, 30_000]);
});

const basic = (...ids) => ids.map((id, i) => ({ id, collector_code: `X-${i + 1}/9`, collector_number: i + 1 }));

test("a printing is basic only with a set's normal number", () => {
  for (const [code, n] of [["OGN-298/298", 298], ["OGS-024/024", 24], ["RAD-001/167", 1], ["SFD-221/221", 221], ["UNL-100/219", 100], ["VEN-166/166", 166]]) {
    assert.equal(isBasicPrinting(code, n), true, code);
  }
  for (const [code, n] of [["VEN-023a/166", 23], ["VEN-197*/166", 197], ["VEN-169/166", 169], ["VEN-SP1/006", 1], ["SFD-T01", 1], ["VEN-R01", 1]]) {
    assert.equal(isBasicPrinting(code, n), false, code);
  }
});

test("a playset skips printings that are not basic", () => {
  const printings = [...basic("a"), { id: "alt", collector_code: "VEN-023a/166", collector_number: 23 }, { id: "rune", collector_code: "VEN-R01", collector_number: 1 }];
  const next = applyPlayset(new Map(), printings, "en", 6);
  assert.deepEqual([...next.keys()], [rowKey("a", "normal", "NM", "en")]);
});

test("a playset tops each printing up to 3 copies, of any language, with normal NM ones in the chosen one", () => {
  const rows = new Map([
    [rowKey("a", "foil", "LP", "en"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("a", "normal", "NM", "fr"), { quantity: 1, for_trade: 1, lendable: null }],
    [rowKey("b", "normal", "NM", "en"), { quantity: 4, for_trade: 0, lendable: null }],
  ]);
  const next = applyPlayset(rows, basic("a", "b", "c"), "fr");
  assert.deepEqual(next.get(rowKey("a", "normal", "NM", "fr")), { quantity: 2, for_trade: 1, lendable: null });
  assert.equal(next.get(rowKey("a", "foil", "LP", "en")).quantity, 1);
  assert.equal(next.get(rowKey("b", "normal", "NM", "en")).quantity, 4);
  assert.equal(next.get(rowKey("c", "normal", "NM", "fr")).quantity, 3);
  assert.equal(next.has(rowKey("c", "normal", "NM", "en")), false);
});

test("two playsets top each printing up to 6 copies, and leave one at 7 alone", () => {
  const rows = new Map([
    [rowKey("a", "foil", "LP", "en"), { quantity: 4, for_trade: 0, lendable: null }],
    [rowKey("b", "normal", "NM", "en"), { quantity: 7, for_trade: 0, lendable: null }],
  ]);
  const next = applyPlayset(rows, basic("a", "b", "c"), "en", 6);
  assert.equal(next.get(rowKey("a", "foil", "LP", "en")).quantity, 4);
  assert.equal(next.get(rowKey("a", "normal", "NM", "en")).quantity, 2);
  assert.equal(next.get(rowKey("b", "normal", "NM", "en")).quantity, 7);
  assert.equal(next.get(rowKey("c", "normal", "NM", "en")).quantity, 6);
});

test("a tile uses its printing in the picked set, or the typed number's", () => {
  // Collector order, as the library sends them: Draven, Showboat is OGN-028 and VEN-172.
  const draven = [
    { set_code: "OGN", collector_code: "OGN-028/298" },
    { set_code: "VEN", collector_code: "VEN-172/166" },
  ];
  const variants = [
    { set_code: "OGN", collector_code: "OGN-034/298" },
    { set_code: "SFD", collector_code: "SFD-034/221" },
    { set_code: "SFD", collector_code: "SFD-034a/221" },
    { set_code: "SFD", collector_code: "SFD-034*/221" },
  ];
  const typed = (query) => (p) => !!query && matchesCode(query, p.collector_code);
  assert.equal(tilePrinting(draven, "", typed("")), draven[0]);
  assert.equal(tilePrinting(draven, "VEN", typed("")), draven[1]);
  assert.equal(tilePrinting(variants, "SFD", typed("")), variants[1]);
  assert.equal(tilePrinting(variants, "SFD", typed("34a")), variants[2]);
  // A number from another set does not pull the tile out of the picked one.
  assert.equal(tilePrinting(draven, "VEN", typed("28")), draven[1]);
  assert.equal(tilePrinting(draven, "", typed("172")), draven[1]);
  assert.equal(tilePrinting(draven, "SFD", typed("")), undefined);
});

const at = (set_code, collector_number, rarity) => ({ set_code, collector_number, collector_code: `${set_code}-${collector_number}`, rarity });
const tiles = [
  { name: "Draven", energy: 3, printing: at("OGN", 28, "Epic"), owned: 1 },
  { name: "Annie", energy: 5, printing: at("OGN", 1, "Common"), owned: 4 },
  { name: "Fury Rune", energy: null, printing: at("OGN", 300, "Rune"), owned: 0 },
  { name: "Jinx", energy: 2, printing: at("SFD", 5, "Showcase"), owned: 2 },
  { name: "Teemo", energy: 3, printing: at("OGN", 50, "Common"), owned: 1 },
];
const order = (sort, descending) => tiles.toSorted(cardOrder(sort, descending, { byPrinting, rarityRank })).map((t) => t.name);

test("set and number: oldest set first, then the number; descending turns it round", () => {
  assert.deepEqual(order("set", false), ["Annie", "Draven", "Teemo", "Fury Rune", "Jinx"]);
  assert.deepEqual(order("set", true), ["Jinx", "Fury Rune", "Teemo", "Draven", "Annie"]);
});

test("name sorts A to Z and back", () => {
  assert.deepEqual(order("name", false), ["Annie", "Draven", "Fury Rune", "Jinx", "Teemo"]);
  assert.deepEqual(order("name", true), ["Teemo", "Jinx", "Fury Rune", "Draven", "Annie"]);
});

test("cost: cards without one last both ways, set and number breaking ties", () => {
  assert.deepEqual(order("cost", false), ["Jinx", "Draven", "Teemo", "Annie", "Fury Rune"]);
  assert.deepEqual(order("cost", true), ["Annie", "Draven", "Teemo", "Jinx", "Fury Rune"]);
});

test("rarity: Common first ascending, an unknown rarity last both ways", () => {
  assert.deepEqual(order("rarity", false), ["Annie", "Teemo", "Draven", "Jinx", "Fury Rune"]);
  assert.deepEqual(order("rarity", true), ["Jinx", "Draven", "Annie", "Teemo", "Fury Rune"]);
});

test("copies owned: fewest first, ties in set order", () => {
  assert.deepEqual(order("owned", false), ["Fury Rune", "Draven", "Teemo", "Jinx", "Annie"]);
  assert.deepEqual(order("owned", true), ["Annie", "Jinx", "Draven", "Teemo", "Fury Rune"]);
});

test("a tile without a printing goes last", () => {
  const none = { name: "Aatrox", energy: 1, printing: undefined, owned: 9 };
  assert.equal([none, ...tiles].toSorted(cardOrder("owned", true, { byPrinting, rarityRank }))[5], none);
});

test("copies owned are summed over every row of a printing", () => {
  const rows = new Map([
    [rowKey("a", "normal", "NM", "en"), { quantity: 2, for_trade: 0, lendable: null }],
    [rowKey("a", "foil", "LP", "fr"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("b", "normal", "NM", "en"), { quantity: 4, for_trade: 0, lendable: null }],
  ]);
  assert.deepEqual([...ownedByPrinting(rows)], [["a", 3], ["b", 4]]);
});
