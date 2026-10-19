import assert from "node:assert/strict";
import { test } from "node:test";
import { serverSummary } from "./home.ts";

test("the server's week, then the visitor's all-time rank", () => {
  assert.equal(serverSummary(1234, 3), "1,234 messages this week · you are #3 all time");
  assert.equal(serverSummary(1, 1), "1 message this week · you are #1 all time");
});

test("a visitor without messages has no rank", () => {
  assert.equal(serverSummary(0, null), "0 messages this week · no messages from you yet");
});
