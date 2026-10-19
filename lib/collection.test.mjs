import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPlayset, NONE, parseKey, retryDelay, rowKey, shown, step } from "./collection.ts";

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
  assert.deepEqual(parseKey(rowKey("PLH-L103", "foil", "LP")), { printing_id: "PLH-L103", finish: "foil", condition: "LP" });
  assert.deepEqual([0, 1, 2, 10].map(retryDelay), [1_000, 2_000, 4_000, 30_000]);
});

test("a playset tops each printing up to 3 copies with normal NM ones", () => {
  const rows = new Map([
    [rowKey("a", "foil", "LP"), { quantity: 1, for_trade: 0, lendable: null }],
    [rowKey("a", "normal", "NM"), { quantity: 1, for_trade: 1, lendable: null }],
    [rowKey("b", "normal", "NM"), { quantity: 4, for_trade: 0, lendable: null }],
  ]);
  const next = applyPlayset(rows, ["a", "b", "c"]);
  assert.deepEqual(next.get(rowKey("a", "normal", "NM")), { quantity: 2, for_trade: 1, lendable: null });
  assert.equal(next.get(rowKey("a", "foil", "LP")).quantity, 1);
  assert.equal(next.get(rowKey("b", "normal", "NM")).quantity, 4);
  assert.equal(next.get(rowKey("c", "normal", "NM")).quantity, 3);
});
