import assert from "node:assert/strict";
import { test } from "node:test";
import { weeklyCounts } from "./weeks.ts";

// A Sunday, so its week started on Monday 2026-10-12.
const now = new Date("2026-10-18T23:00:00Z");

test("sums days into weeks from Monday, oldest first, zeros filled in", () => {
  const days = [
    { day: "2026-10-12", count: 2 },
    { day: "2026-10-18", count: 3 },
    { day: "2026-10-11", count: 5 },
  ];
  assert.deepEqual(weeklyCounts(days, now, 3), [
    { week: "2026-09-28", count: 0 },
    { week: "2026-10-05", count: 5 },
    { week: "2026-10-12", count: 5 },
  ]);
});

test("ignores days before the first week", () => {
  assert.deepEqual(weeklyCounts([{ day: "2026-10-04", count: 9 }], now, 2), [
    { week: "2026-10-05", count: 0 },
    { week: "2026-10-12", count: 0 },
  ]);
});
