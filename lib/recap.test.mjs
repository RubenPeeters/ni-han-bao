import assert from "node:assert/strict";
import { test } from "node:test";
import { funFact, hourLabel, recapAlt, recapMonth } from "./recap.ts";

const empty = {
  server: "x",
  top_talkers: [],
  busiest_channel: null,
  top_emoji: null,
  peak_hour: null,
  busiest_day: null,
  messages: 0,
};

test("recapMonth accepts YYYY-MM only", () => {
  assert.equal(recapMonth("2026-09"), "2026-09-01");
  assert.equal(recapMonth("2026-12"), "2026-12-01");
  for (const bad of ["2026-13", "2026-00", "2026-9", "2026-09-01", "x", "2026-09'"]) {
    assert.equal(recapMonth(bad), null, bad);
  }
});

test("hourLabel wraps at midnight", () => {
  assert.equal(hourLabel(9), "09:00 to 10:00");
  assert.equal(hourLabel(23), "23:00 to 00:00");
});

test("funFact", () => {
  assert.equal(funFact(empty), "Not a single message all month. Peaceful, honestly.");
  const data = { ...empty, messages: 1200, busiest_day: { day: "2026-09-12", message_count: 300 } };
  assert.equal(funFact(data), "1,200 messages in total. Saturday, September 12 alone had 25% of them.");
});

test("recapAlt of an empty month", () => {
  assert.match(recapAlt("2026-09-01", empty), /^Monthly recap for September 2026\. Top chatters: nobody\./);
});

test("funFact of a single message", () => {
  const data = { ...empty, messages: 1, busiest_day: { day: "2026-09-01", message_count: 1 } };
  assert.equal(funFact(data), "1 message in total. Tuesday, September 1 alone had 100% of them.");
});
