import assert from "node:assert/strict";
import { test } from "node:test";
import { switchPath } from "./server-pages.ts";

test("a tab carries over to the other server", () => {
  assert.equal(switchPath("/s/1/emoji", "2"), "/s/2/emoji");
});

test("pages that are not tabs go to the other server's leaderboard", () => {
  assert.equal(switchPath("/s/1/member/42", "2"), "/s/2/leaderboard");
  assert.equal(switchPath("/s/1/recap/2026-09", "2"), "/s/2/leaderboard");
  assert.equal(switchPath("/s/1", "2"), "/s/2/leaderboard");
});

test("every grouped page carries over", () => {
  for (const page of ["games", "stores", "trades", "ranked"]) assert.equal(switchPath(`/s/1/${page}`, "2"), `/s/2/${page}`);
});
