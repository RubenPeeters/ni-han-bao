import assert from "node:assert/strict";
import { test } from "node:test";
import { currentRiftboundTab, riftboundTabs } from "./riftbound-pages.ts";

test("logged out, only the catalogue", () => {
  assert.deepEqual(riftboundTabs(false).map((t) => t.label), ["Cards", "Decks", "Open a pack"]);
  assert.deepEqual(riftboundTabs(true).map((t) => t.href), ["/cards", "/decks", "/packs", "/collection", "/loans", "/wishlist"]);
});

test("a card or deck page marks its list", () => {
  assert.equal(currentRiftboundTab("/cards/ahri"), "/cards");
  assert.equal(currentRiftboundTab("/decks/x/versions/2"), "/decks");
});

test("my own pages are in the row; profiles are not, mine included", () => {
  assert.equal(currentRiftboundTab("/loans"), "/loans");
  assert.equal(currentRiftboundTab("/collection"), "/collection");
  assert.equal(currentRiftboundTab("/u/1/loans"), undefined);
  assert.equal(currentRiftboundTab("/u/1"), undefined);
  assert.equal(currentRiftboundTab("/s"), undefined);
  assert.equal(currentRiftboundTab("/collections"), undefined);
});
