import assert from "node:assert/strict";
import { test } from "node:test";
import { available, isPermanent, retryDelay, step } from "./collection.ts";

const copy = { printing: "p", finish: "normal", condition: "NM", quantity: 2, for_trade: 2, lendable: null };

test("a copy is never below 0, and trade copies never above the copies owned", () => {
  assert.equal(step({ ...copy, quantity: 0 }, "quantity", -1, false).quantity, 0);
  assert.equal(step(copy, "quantity", -1, false).for_trade, 1);
  assert.equal(step(copy, "for_trade", 1, false).for_trade, 2);
});

test("a card lent in full stays lent in full; a partial count stays put", () => {
  assert.equal(step({ ...copy, lendable: 2 }, "quantity", 1, false).lendable, 3);
  assert.equal(step({ ...copy, lendable: 1 }, "quantity", 1, false).lendable, 1);
  assert.equal(step(copy, "quantity", 1, false).lendable, null);
});

test("the lend stepper starts from the owner's default", () => {
  assert.equal(step(copy, "lendable", -1, true).lendable, 1);
  assert.equal(step(copy, "lendable", 1, false).lendable, 1);
});

test("nothing is available while the owner does not lend", () => {
  assert.equal(available({ ...copy, lendable: 2 }, false, true), 0);
  assert.equal(available(copy, true, true), 2);
  assert.equal(available(copy, true, false), 0);
  assert.equal(available({ ...copy, lendable: 1 }, true, true), 1);
});

test("dropped connections are retried, rejected values are not", () => {
  assert.equal(isPermanent({ code: "" }), false);
  assert.equal(isPermanent({}), false);
  assert.equal(isPermanent({ code: "PGRST301" }), false);
  assert.equal(isPermanent({ code: "P0001" }), true);
  assert.equal(isPermanent({ code: "23514" }), true);
  assert.equal(retryDelay(0), 1000);
  assert.equal(retryDelay(10), 30_000);
});
