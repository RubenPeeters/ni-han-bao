import assert from "node:assert/strict";
import { test } from "node:test";
import { countingSince, historyPercent, warmingUp } from "./history.ts";

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

test("counting since: the time inside the boundary snowflake", () => {
  // Discord's documented example: 175928847299117063 was created at 2016-04-30T11:18:25.796Z.
  assert.equal(countingSince("175928847299117063").toISOString(), "2016-04-30T11:18:25.796Z");
});

test("warming up for the first week of counting", () => {
  const since = new Date("2026-10-18T12:00:00Z");
  assert.equal(warmingUp(since, new Date("2026-10-18T12:00:00Z")), true);
  assert.equal(warmingUp(since, new Date("2026-10-25T11:59:59Z")), true);
  assert.equal(warmingUp(since, new Date("2026-10-25T12:00:00Z")), false);
});
