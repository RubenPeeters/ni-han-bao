import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesCode } from "../bot/src/card-match.ts";
import { applyPlayset, NONE, parseKey, retryDelay, rowKey, shown, step, tilePrinting } from "./collection.ts";

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

test("a playset tops each printing up to 3 copies, of any language, with normal NM ones in the chosen one", () => {
  const rows = new Map([
    [rowKey("a", "foil", "LP", "en"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("a", "normal", "NM", "fr"), { quantity: 1, for_trade: 1, lendable: null }],
    [rowKey("b", "normal", "NM", "en"), { quantity: 4, for_trade: 0, lendable: null }],
  ]);
  const next = applyPlayset(rows, ["a", "b", "c"], "fr");
  assert.deepEqual(next.get(rowKey("a", "normal", "NM", "fr")), { quantity: 2, for_trade: 1, lendable: null });
  assert.equal(next.get(rowKey("a", "foil", "LP", "en")).quantity, 1);
  assert.equal(next.get(rowKey("b", "normal", "NM", "en")).quantity, 4);
  assert.equal(next.get(rowKey("c", "normal", "NM", "fr")).quantity, 3);
  assert.equal(next.has(rowKey("c", "normal", "NM", "en")), false);
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
