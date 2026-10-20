import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  brokenText,
  checksum,
  diffCatalogue,
  parseProposalButtonId,
  proposalButtonId,
  proposalText,
  proposalCounts,
} from "./catalogue-check.js";
import { feedItems, transformFeed, type FeedCard } from "./riftbound-feed.js";

const feed = transformFeed(feedItems(JSON.parse(readFileSync(new URL("riftbound-feed.fixture.json", import.meta.url), "utf8"))));
// What the database returns: the same columns, from an earlier copy of the feed.
const stored = () => structuredClone({ cards: feed.cards, printings: feed.printings });

describe("diffCatalogue", () => {
  it("finds nothing when the database has the feed", () => {
    expect(diffCatalogue(feed, stored())).toEqual({ sets: [], cards: [], printings: [] });
  });

  it("ignores placeholders, and a null the database leaves out", () => {
    const db = stored();
    const placeholder: FeedCard = { ...db.cards[0], id: "placeholder-unit-ahri", name: "Ahri, Ashen Blade", placeholder: true };
    db.cards.push(placeholder);
    delete (db.printings[0] as Partial<typeof db.printings[0]>).illustrator;
    db.printings[0].illustrator = feed.printings[0].illustrator;
    expect(diffCatalogue(feed, db).sets).toEqual([]);
  });

  it("counts new, changed and gone cards per set and upserts only what differs", () => {
    const db = stored();
    db.cards = db.cards.filter((c) => c.id !== "body-rune");
    db.printings = db.printings.filter((p) => p.card_id !== "body-rune");
    db.cards.find((c) => c.id === "blade-of-the-exile")!.rules_text = "<p>Old wording.</p>";
    db.cards.find((c) => c.id === "buff")!.might = 9;
    // A new printing of a known card: changed, under the set of its newest printing.
    db.printings = db.printings.filter((p) => p.id !== "ven-sp2-006");
    db.cards.push({ ...feed.cards[0], id: "retired-card", name: "Retired Card" });
    db.printings.push({ ...feed.printings[0], id: "retired-printing", card_id: "retired-card", set_code: "OGN" });

    const diff = diffCatalogue(feed, db);
    expect(diff.sets).toEqual([
      { set: "OGN", added: [], changed: [], gone: ["Retired Card"] },
      { set: "UNL", added: [], changed: ["Buff"], gone: [] },
      { set: "VEN", added: ["Body Rune"], changed: ["Sona, Harmonious"], gone: [] },
      { set: "RAD", added: [], changed: ["Blade of the Exile"], gone: [] },
    ]);
    expect(proposalCounts(diff)).toEqual({ added: 1, changed: 3, gone: 1 });
    expect(diff.cards.map((c) => c.id)).toEqual(["blade-of-the-exile", "body-rune", "buff"]);
    expect(diff.printings.map((p) => p.id)).toEqual(["ven-r04", "ven-sp2-006"]);
  });

  it("puts sets in release order", () => {
    const diff = diffCatalogue(feed, { cards: [], printings: [] });
    const order = ["OGN", "OGS", "SFD", "UNL", "VEN", "RAD"];
    expect(diff.sets.map((s) => order.indexOf(s.set))).toEqual(diff.sets.map((s) => order.indexOf(s.set)).sort());
    expect(proposalCounts(diff).added).toBe(feed.cards.length);
  });
});

describe("checksum", () => {
  it("is the content's, so a changed card changes it", () => {
    const other = structuredClone(feed);
    other.cards[0].name = "Renamed";
    expect(checksum(feed)).toBe(checksum(structuredClone(feed)));
    expect(checksum(other)).not.toBe(checksum(feed));
  });
});

describe("proposalText", () => {
  it("gives the build id, the counts per set and the first names", () => {
    const text = proposalText("abc123", {
      sets: [
        { set: "VEN", added: ["A", "B", "C", "D"], changed: [], gone: [] },
        { set: "RAD", added: [], changed: ["E"], gone: ["F", "G"] },
      ],
      cards: [],
      printings: [],
    });
    expect(text).toBe(
      "Riot's Riftbound card feed (build `abc123`) differs from the catalogue.\n" +
        "**VEN**: 4 new (A, B, C, …), 0 changed, 0 no longer in the feed\n" +
        "**RAD**: 0 new, 1 changed (E), 2 no longer in the feed (F, G)\n" +
        "Accept writes the new and changed cards. Cards no longer in the feed stay: collections, decks and loans point at them.",
    );
  });

  it("stays within Discord's limit", () => {
    expect(proposalText("x", diffCatalogue(feed, { cards: [], printings: [] })).length).toBeLessThanOrEqual(2000);
  });
});

describe("brokenText", () => {
  it("says why and that nothing changed", () => {
    expect(brokenText(new Error("expected one card array in the feed, found 0"))).toBe(
      "Riot's Riftbound card feed could not be read, so the catalogue is unchanged: expected one card array in the feed, found 0",
    );
  });
});

describe("proposal buttons", () => {
  it("round-trips the decision and the proposal", () => {
    expect(parseProposalButtonId(proposalButtonId("accept", 12))).toEqual({ kind: "accepted", proposal: 12 });
    expect(parseProposalButtonId(proposalButtonId("reject", 3))).toEqual({ kind: "rejected", proposal: 3 });
    expect(parseProposalButtonId("loan-confirm:1:2")).toBeNull();
  });
});
