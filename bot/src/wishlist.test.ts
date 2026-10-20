import assert from "node:assert/strict";
import { test } from "vitest";
import { wishlist, type WishRow } from "./wishlist.js";

const row = (r: Partial<WishRow>): WishRow => ({ card_id: "x", printing_id: null, language: null, deck: null, decks: 0, manual: null, copies: [], ...r });
const copy = (printing_id: string, quantity: number, language = "en") => ({ printing_id, language, quantity });
const wanted = (rows: WishRow[]) => wishlist(rows).map((r) => r.wanted);

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

test("a copy moves to the need that can only use it, whatever order the copies come in", () => {
  // One P1 in any language and one of any printing in French: P1 French goes to the French need.
  const needs = (copies) => [row({ printing_id: "P1", decks: 1, copies }), row({ language: "fr", decks: 1, copies })];
  assert.deepEqual(wanted(needs([copy("P1", 1, "fr"), copy("P1", 1, "en")])), [0, 0]);
  assert.deepEqual(wanted(needs([copy("P1", 1, "en"), copy("P1", 1, "fr")])), [0, 0]);
});

test("shared decks lend each other copies across pins", () => {
  const decks = (copies) => [row({ deck: 1, decks: 3, copies }), row({ printing_id: "P1", deck: 2, decks: 2, copies })];
  // Three of any printing and two P1 between them: two P1 and a P2 build either.
  assert.deepEqual(wanted(decks([copy("P1", 2), copy("P2", 1)])), [0, 0]);
  assert.deepEqual(wanted(decks([])), [1, 2]);
  assert.deepEqual(wanted(decks([copy("P2", 3)])), [0, 2]);
  assert.deepEqual(wishlist(decks([])).map((r) => r.decks), [3, 2]);
});

test("a shared deck is built beside the dedicated ones", () => {
  const rows = [row({ decks: 2, copies: [copy("P1", 3)] }), row({ deck: 1, decks: 2, copies: [copy("P1", 3)] })];
  assert.deepEqual(wanted(rows), [1]);
  assert.deepEqual(wishlist(rows).map((r) => r.decks), [4]);
});
