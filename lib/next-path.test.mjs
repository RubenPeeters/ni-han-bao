import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPath } from "./next-path.ts";

test("paths on this site are kept", () => {
  assert.equal(nextPath("/collection"), "/collection");
  assert.equal(nextPath("/s/123/decks"), "/s/123/decks");
  assert.equal(nextPath("/decks?share=abc&x=1"), "/decks?share=abc&x=1");
});

test("the home page and no value go to the picker", () => {
  assert.equal(nextPath("/"), "/s");
  assert.equal(nextPath("/?x=1"), "/s");
  assert.equal(nextPath(""), "/s");
  assert.equal(nextPath(null), "/s");
});

test("other hosts go to the picker", () => {
  for (const next of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
  ]) {
    assert.equal(nextPath(next), "/s", next);
  }
});

test("over-long values go to the picker", () => {
  assert.equal(nextPath("/" + "a".repeat(299)), "/" + "a".repeat(299));
  assert.equal(nextPath("/" + "a".repeat(300)), "/s");
});
