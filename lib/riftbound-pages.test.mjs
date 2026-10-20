import assert from "node:assert/strict";
import { test } from "node:test";
import { currentRiftboundTab, riftboundTabs } from "./riftbound-pages.ts";

test("logged out, only the catalogue", () => {
  assert.deepEqual(riftboundTabs(null).map((t) => t.label), ["Cards", "Decks"]);
  assert.equal(currentRiftboundTab("/u/1/collection", null), undefined);
});

test("a card or deck page marks its list", () => {
  assert.equal(currentRiftboundTab("/cards/ahri", null), "/cards");
  assert.equal(currentRiftboundTab("/decks/x/versions/2", "1"), "/decks");
});

test("only my own pages are in the row, not someone else's", () => {
  assert.equal(currentRiftboundTab("/u/1/loans", "1"), "/u/1/loans");
  assert.equal(currentRiftboundTab("/u/2/loans", "1"), undefined);
  assert.equal(currentRiftboundTab("/u/1", "1"), undefined);
  assert.equal(currentRiftboundTab("/s", "1"), undefined);
});
