import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyPath } from "./legacy.ts";

test("one server: straight to its page", () => {
  assert.equal(legacyPath(["123"], "emoji"), "/s/123/emoji");
});

test("none (or logged out) and several: the picker", () => {
  assert.equal(legacyPath([], "emoji"), "/s");
  assert.equal(legacyPath(["1", "2"], "emoji"), "/s");
});
