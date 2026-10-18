import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExact, formatRelative } from "./time.ts";

const now = new Date("2026-10-18T12:00:00Z");
const ago = (sec) => formatRelative(new Date(now.getTime() - sec * 1000), now);

test("seconds", () => {
  assert.equal(ago(0), "now");
  assert.equal(ago(-30), "now");
  assert.equal(ago(5), "5 sec ago");
  assert.equal(ago(59), "59 sec ago");
});

test("minutes", () => {
  assert.equal(ago(60), "1 min ago");
  assert.equal(ago(120), "2 min ago");
  assert.equal(ago(3599), "59 min ago");
});

test("hours", () => {
  assert.equal(ago(3600), "1 hr ago");
  assert.equal(ago(86399), "23 hr ago");
});

test("days", () => {
  assert.equal(ago(86400), "yesterday");
  assert.equal(ago(2 * 86400 - 1), "yesterday");
  assert.equal(ago(2 * 86400), "2 days ago");
  assert.equal(ago(40 * 86400), "40 days ago");
});

test("exact time is Brussels wall clock, DST-aware", () => {
  assert.equal(formatExact(new Date("2026-10-17T15:38:11Z")), "17 Oct 2026, 17:38 CEST");
  assert.equal(formatExact(new Date("2026-12-01T15:38:11Z")), "1 Dec 2026, 16:38 CET");
});
