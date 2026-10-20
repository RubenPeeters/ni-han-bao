import assert from "node:assert/strict";
import { test } from "node:test";
import { wishlist } from "./wishlist.ts";

const row = (r) => ({ card_id: "x", printing_id: null, language: null, decks: 0, manual: null, copies: [], ...r });
const copy = (printing_id, quantity, language = "en") => ({ printing_id, language, quantity });
const wanted = (rows) => wishlist(rows).map((r) => r.wanted);

test("what the decks need, minus what is owned", () => {
  assert.deepEqual(wanted([row({ decks: 5, copies: [copy("P1", 2)] })]), [3]);
  assert.deepEqual(wanted([row({ decks: 2, copies: [copy("P1", 3)] })]), [0]);
});

test("a target is a total: the larger of it and the decks, never both", () => {
  assert.deepEqual(wanted([row({ decks: 3, manual: 4, copies: [copy("P1", 1)] })]), [3]);
  assert.deepEqual(wanted([row({ decks: 3, manual: 2 })]), [3]);
  // Two copies of P1 still to get for a deck count towards wanting four of the card.
  assert.deepEqual(wanted([row({ printing_id: "P1", decks: 2 }), row({ manual: 4 })]), [2, 2]);
});

test("a pin takes only its printing, and first", () => {
  const copies = [copy("P1", 1), copy("P2", 2)];
  assert.deepEqual(wanted([row({ decks: 2, copies }), row({ printing_id: "P1", decks: 2, copies })]), [0, 1]);
});

test("with other languages off, only that language counts", () => {
  const copies = [copy("P1", 3, "en"), copy("P1", 1, "fr")];
  assert.deepEqual(wanted([row({ language: "fr", decks: 2, copies })]), [1]);
  assert.deepEqual(wanted([row({ language: "fr", decks: 2, copies }), row({ decks: 3, copies })]), [1, 0]);
});

test("cards do not share copies", () => {
  assert.deepEqual(wanted([row({ decks: 1, copies: [copy("P1", 1)] }), row({ card_id: "y", decks: 1 })]), [0, 1]);
});
