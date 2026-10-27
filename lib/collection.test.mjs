import assert from "node:assert/strict";
import { test } from "node:test";
import { byPrinting, matchesCode, rarityRank } from "../bot/src/card-match.ts";
import { applyPlayset, cardOrder, deckCopies, gridTiles, isBasicPrinting, NONE, ownedByPrinting, parseKey, perLanguage, retryDelay, rowKey, rowsByPrinting, shown, step, tileCopies, tilePrinting } from "./collection.ts";

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
    { set_code: "OGN", collector_code: "OGN-028/298", collector_number: 28 },
    { set_code: "VEN", collector_code: "VEN-172/166", collector_number: 172 },
  ];
  const variants = [
    { set_code: "OGN", collector_code: "OGN-034/298", collector_number: 34 },
    { set_code: "SFD", collector_code: "SFD-034/221", collector_number: 34 },
    { set_code: "SFD", collector_code: "SFD-034a/221", collector_number: 34 },
    { set_code: "SFD", collector_code: "SFD-034*/221", collector_number: 34 },
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

// Zed, From the Shadows (#285): the alternate art sorts before the basic printing.
const zed = {
  name: "Zed",
  printings: [
    { id: "ven-23a", set_code: "VEN", collector_code: "VEN-023a/166", collector_number: 23 },
    { id: "ven-23", set_code: "VEN", collector_code: "VEN-023/166", collector_number: 23 },
    { id: "ven-169", set_code: "VEN", collector_code: "VEN-169/166", collector_number: 169 },
  ],
};
const token = { name: "Sprite", printings: [{ id: "tok", set_code: "OGN", collector_code: "OGN-T01", collector_number: 1 }] };
const zedOwned = new Map([["ven-23a", 6], ["ven-169", 6]]);
const tilesOf = (view, set = "", { kept = () => true, named = () => true, query = "" } = {}) =>
  gridTiles([zed, token], { view, set, kept, named, hit: (p) => !!query && matchesCode(query, p.collector_code), owned: zedOwned }).map((t) => [
    t.name,
    t.printing?.id,
    t.owned,
    t.elsewhere,
  ]);

test("one per card: the basic printing, with the copies on the others counted apart", () => {
  const zedTile = ["Zed", "ven-23", 12, 12];
  assert.deepEqual(tilesOf("card", "VEN"), [zedTile]);
  // No basic printing: the first, as before.
  assert.deepEqual(tilesOf("card"), [zedTile, ["Sprite", "tok", 0, 0]]);
  // A typed number steps the printing it finds.
  assert.deepEqual(tilesOf("card", "", { named: () => false, query: "VEN-169" }), [["Zed", "ven-169", 12, 6]]);
  // ...but not past the type, domain and cost filters.
  assert.deepEqual(tilesOf("card", "", { kept: () => false, named: () => false, query: "VEN-169" }), []);
});

test("every printing: a tile each, with its own copies, the set filter per printing", () => {
  assert.deepEqual(tilesOf("printing", "VEN"), [
    ["Zed", "ven-23a", 6, 0],
    ["Zed", "ven-23", 0, 0],
    ["Zed", "ven-169", 6, 0],
  ]);
  assert.equal(tilesOf("printing").length, 4);
  assert.deepEqual(tilesOf("printing", "OGN"), [["Sprite", "tok", 0, 0]]);
  assert.deepEqual(tilesOf("printing", "", { named: () => false, query: "VEN-023a" }), [["Zed", "ven-23a", 6, 0]]);
  assert.deepEqual(tilesOf("printing", "", { kept: () => false, named: () => false, query: "VEN-023a" }), []);
  assert.deepEqual(tilesOf("printing", "", { named: (c) => c.name === "Sprite" }), [["Sprite", "tok", 0, 0]]);
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

test("Who has it? names each language with its copies", () => {
  assert.equal(perLanguage(3), "3 to lend");
  assert.equal(perLanguage([{ language: "en", copies: 1 }, { language: "fr", copies: 1 }, { language: "zh-Hans", copies: 2 }]), "EN 1 · FR 1 · ZH 2");
});

test("a tile's copies: every row of its printings, and a chip per other language (#297)", () => {
  const rows = new Map([
    [rowKey("ogn-1", "foil", "NM", "en"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("ogn-1", "normal", "NM", "fr"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("ogn-1", "normal", "LP", "en"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("ogn-1", "normal", "NM", "en"), { quantity: 0, for_trade: 0, lendable: null }],
    [rowKey("sfd-1", "normal", "NM", "zh-Hans"), { quantity: 2, for_trade: 0, lendable: null }],
  ]);
  const by = rowsByPrinting(rows);
  const tile = tileCopies(by, ["ogn-1"], "en");
  assert.deepEqual(
    tile.rows.map((r) => [r.language, r.finish, r.condition, r.quantity]),
    [
      ["en", "normal", "NM", 0],
      ["en", "normal", "LP", 1],
      ["en", "foil", "NM", 1],
      ["fr", "normal", "NM", 1],
    ],
  );
  assert.deepEqual(tile.chips, [{ language: "fr", copies: 1 }]);
  // The card's tile counts every printing; the entry language gets no chip.
  assert.deepEqual(tileCopies(by, ["ogn-1", "sfd-1"], "fr").chips, [
    { language: "en", copies: 2 },
    { language: "zh-Hans", copies: 2 },
  ]);
  assert.deepEqual(tileCopies(by, ["unowned"], "en"), { rows: [], chips: [] });
});

test("decks hold their own language's copies in hand first, then the others' (#297)", () => {
  const rows = [
    { key: "en-a", language: "en", quantity: 2 },
    { key: "en-b", language: "en", quantity: 1 },
    { key: "fr", language: "fr", quantity: 2 },
  ];
  const held = deckCopies(rows, new Map([["en-a", 1]]), [
    { name: "Sleeved Kai'Sa", language: "en", copies: 3 },
    { name: "French", language: "fr", copies: 1 },
  ]);
  // en-a has one in hand (one is lent), en-b one: the third copy spills onto the French row.
  assert.deepEqual(Object.fromEntries(held), {
    "en-a": [{ name: "Sleeved Kai'Sa", copies: 1 }],
    "en-b": [{ name: "Sleeved Kai'Sa", copies: 1 }],
    fr: [
      { name: "French", copies: 1 },
      { name: "Sleeved Kai'Sa", copies: 1 },
    ],
  });
  // More than in hand: what is left is held nowhere.
  assert.deepEqual(Object.fromEntries(deckCopies(rows.slice(2), new Map(), [{ name: "D", language: "en", copies: 5 }])), {
    fr: [{ name: "D", copies: 2 }],
  });
});
