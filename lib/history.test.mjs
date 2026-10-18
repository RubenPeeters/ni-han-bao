import assert from "node:assert/strict";
import { test } from "node:test";
import { historyPercent } from "./history.ts";

test("channels done of total, rounded down", () => {
  assert.equal(historyPercent(2, 5), 40);
  assert.equal(historyPercent(2, 3), 66);
});

test("0% before the channels are listed or when there are none", () => {
  assert.equal(historyPercent(0, null), 0);
  assert.equal(historyPercent(0, 0), 0);
});

test("never 100% while not marked done, e.g. a channel that failed", () => {
  assert.equal(historyPercent(5, 5), 99);
});
