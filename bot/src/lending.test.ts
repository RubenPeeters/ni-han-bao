import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  answerId,
  answerReply,
  deckChoices,
  deckWanted,
  lendAnnouncement,
  lendChoices,
  lendReceipt,
  lendWhat,
  loanCards,
  nudgeMessage,
  parseAnswerId,
  parseCards,
  parseDisputeFormId,
  disputeFormId,
  parseDue,
  pickCopies,
  returnReply,
  type CopyRow,
  type Wanted,
} from "./lending.js";
import { choiceLabel, type Catalogue } from "./riftbound.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const unit = catalogue.cards.find((c) => c.id === "ahri-alluring")!;
const legend = catalogue.cards.find((c) => c.id === "nine-tailed-fox")!;

describe("parseCards", () => {
  it("reads counts before or after a name, and adds up a card named twice", () => {
    const parsed = parseCards(catalogue, `2 ${unit.name}; OGN-255 x2;1x ogn-255/298`) as Wanted[];
    expect(parsed.map((w) => [w.card.id, w.count])).toEqual([
      [unit.id, 2],
      [legend.id, 3],
    ]);
  });

  it("takes a picked suggestion's label", () => {
    expect((parseCards(catalogue, choiceLabel(legend)) as Wanted[])[0].card).toBe(legend);
  });

  it("says which card it does not know, and rejects an empty list or a count of 0", () => {
    expect(parseCards(catalogue, `${choiceLabel(unit)}; nope`)).toContain('"nope"');
    expect(parseCards(catalogue, " ; ")).toBe("Name at least one card.");
    expect(parseCards(catalogue, "0 OGN-255")).toContain("at least 1");
  });
});

describe("lendChoices", () => {
  it("completes the last card and keeps the ones before it with their counts", () => {
    const choices = lendChoices(catalogue, "2 OGN-255; 3 ahri, a");
    expect(choices.map((c) => c.value)).toContain(`2 OGN-255; 3 ${choiceLabel(unit)}`);
    expect(choices.every((c) => c.name === c.value)).toBe(true);
    // Every suggestion parses back to the cards it shows.
    expect(parseCards(catalogue, choices[0].value)).toHaveLength(2);
  });

  it("drops a suggestion past Discord's 100 characters", () => {
    expect(lendChoices(catalogue, `${"x".repeat(95)}; ahri`)).toEqual([]);
  });
});

describe("parseDue", () => {
  it("takes no date, a date from today on, and nothing else", () => {
    expect(parseDue(null, "2026-10-19")).toEqual({ due: null });
    expect(parseDue(" 2026-10-19 ", "2026-10-19")).toEqual({ due: "2026-10-19" });
    expect(parseDue("2026-10-18", "2026-10-19")).toContain("passed");
    expect(parseDue("2026-02-30", "2026-01-01")).toContain("like 2026-11-02");
    expect(parseDue("next week", "2026-01-01")).toContain("like 2026-11-02");
  });
});

describe("pickCopies", () => {
  const row = (over: Partial<CopyRow>): CopyRow => ({
    card_id: unit.id,
    printing_id: "ogn-066-298",
    finish: "normal",
    condition: "NM",
    language: "en",
    quantity: 2,
    lendable: 0,
    lent: 0,
    held: 0,
    ...over,
  });

  it("takes copies available to lend first, then the rest with a warning", () => {
    const rows = [row({ finish: "foil", quantity: 3, lendable: 0 }), row({ quantity: 2, lendable: 2, lent: 1 })];
    expect(pickCopies(rows, [{ card: unit, count: 3 }])).toEqual({
      cards: [
        { printing_id: "ogn-066-298", finish: "foil", condition: "NM", language: "en", quantity: 2 },
        { printing_id: "ogn-066-298", finish: "normal", condition: "NM", language: "en", quantity: 1 },
      ],
      unmarked: 2,
    });
  });

  it("does not warn when the copies are available to lend", () => {
    expect(pickCopies([row({ lendable: 2 })], [{ card: unit, count: 2 }])).toMatchObject({ unmarked: 0 });
  });

  it("counts copies a deck not for lending holds as not available to lend, whatever the per-card counts say", () => {
    const rows = [row({ finish: "foil", quantity: 2, lendable: 2, held: 3 }), row({ quantity: 2, lendable: 2, held: 3 })];
    // 4 in hand, 3 held: 1 is still available to lend.
    expect(pickCopies(rows, [{ card: unit, count: 1 }])).toMatchObject({ unmarked: 0 });
    expect(pickCopies(rows, [{ card: unit, count: 3 }])).toMatchObject({ unmarked: 2 });
    expect(pickCopies([row({ lendable: 2, held: 9 })], [{ card: unit, count: 1 }])).toMatchObject({ unmarked: 1 });
  });

  it("refuses copies the lender does not have in hand", () => {
    expect(pickCopies([row({ quantity: 2, lent: 1 })], [{ card: unit, count: 2 }])).toContain("only 1");
    expect(pickCopies([], [{ card: legend, count: 1 }])).toContain("no ");
  });
});

describe("lending a deck", () => {
  it("takes cards or a deck, exactly one", () => {
    expect(lendWhat("2 Jinx", null)).toEqual({ cards: "2 Jinx" });
    expect(lendWhat(null, " d1 ")).toEqual({ deck: "d1" });
    expect(lendWhat("Jinx", "d1")).toContain("not both");
    expect(lendWhat(" ", null)).toContain("Name the cards");
  });

  it("wants the Legend and every entry, added up per card", () => {
    const wanted = deckWanted(catalogue, {
      legend_id: legend.id,
      entries: [
        { card_id: unit.id, quantity: 2 },
        { card_id: unit.id, quantity: 1 },
      ],
    }) as Wanted[];
    expect(wanted.map((w) => [w.card.id, w.count])).toEqual([
      [legend.id, 1],
      [unit.id, 3],
    ]);
    expect(deckWanted(catalogue, { legend_id: null, entries: [] })).toContain("no cards");
    expect(deckWanted(catalogue, { legend_id: "gone", entries: [] })).toContain("no longer in the catalogue");
  });

  it("suggests the lender's decks by name, with their ids", () => {
    const decks = [
      { id: "b", name: "Jinx aggro" },
      { id: "a", name: "Ahri control" },
    ];
    expect(deckChoices(decks, "")).toEqual([
      { name: "Ahri control", value: "a" },
      { name: "Jinx aggro", value: "b" },
    ]);
    expect(deckChoices(decks, "JINX")).toEqual([{ name: "Jinx aggro", value: "b" }]);
  });

  it("names the deck and pictures its Legend instead of its cards", () => {
    const view = { loan: 7, lender: "a", borrower: "b", cards: [{ card: unit, count: 3 }, { card: legend, count: 1 }], due: null, deck: { name: "Ahri control", legend } };
    const text = JSON.stringify(lendReceipt(view, 0, null, catalogue, new Map()));
    expect(text).toContain("### Recorded loan #7\\n<@a> lent <@b> the deck **Ahri control** (4 cards) · no due date");
    expect(text).toContain(`"description":"${legend.name}"`);
    expect(text.match(/"type":11/g)).toHaveLength(1);
    expect(JSON.stringify(lendAnnouncement(view, catalogue, new Map()))).toContain("lent <@b> the deck **Ahri control** (4 cards)");
  });
});

describe("replies", () => {
  it("adds up a loan's rows per card, from the catalogue", () => {
    const rows = [{ printing_id: "ogn-255-298", quantity: 2 }, { printing_id: "ogn-255-298", quantity: 1 }, { printing_id: "gone", quantity: 1 }];
    expect(loanCards(catalogue, rows).map((w) => [w.card.name, w.count])).toEqual([[legend.name, 3], ["gone", 1]]);
  });

  const view = { loan: 7, lender: "a", borrower: "b", cards: [{ card: legend, count: 1 }], due: "2026-11-02", deck: null };

  it("pictures one or two cards, each a line with its domains, and lists more", () => {
    const emojis = new Map([["rb_mind", "1"]]);
    const one = JSON.stringify(lendAnnouncement(view, catalogue, emojis));
    expect(one).toContain("lent <@b> 1 card · due 2026-11-02");
    expect(one).toContain(`1× ${legend.name} Calm <:rb_mind:1>`);
    expect(one.match(/"type":11/g)).toHaveLength(1);
    const three = { ...view, cards: [{ card: legend, count: 1 }, { card: unit, count: 2 }, { card: catalogue.cards[0], count: 1 }] };
    expect(JSON.stringify(lendAnnouncement(three, catalogue, emojis))).not.toContain('"type":11');
  });

  it("keeps Confirm and Dispute for the borrower, and the due-date DM says what to do", () => {
    const text = JSON.stringify(lendAnnouncement(view, catalogue, new Map()));
    expect(text).toContain(`"custom_id":"${answerId("confirm", 7, "b")}"`);
    expect(text).toContain(`"custom_id":"${answerId("dispute", 7, "b")}"`);
    expect(JSON.stringify(nudgeMessage(view, catalogue, new Map()))).toContain("### Loan #7 is due");
  });

  it("warns the lender about copies not marked to lend, and names a corrected loan", () => {
    const receipt = JSON.stringify(lendReceipt(view, 1, 3, catalogue, new Map()));
    expect(receipt).toContain("loan #7");
    expect(receipt).toContain("#3 no longer counts");
    expect(receipt).toContain("1 of these copies is not marked");
    expect(JSON.stringify(lendReceipt(view, 0, null, catalogue, new Map()))).not.toContain("Heads-up");
  });

  it("round-trips button and form ids", () => {
    expect(parseAnswerId(answerId("dispute", 12, "345"))).toEqual({ kind: "disputed", loan: 12, borrower: "345" });
    expect(parseAnswerId("event-going:1")).toBeNull();
    expect(parseDisputeFormId(disputeFormId(12))).toBe(12);
  });

  it("explains an answer that was not saved", () => {
    expect(answerReply("not_borrower", "confirmed")).toContain("Only the borrower");
    expect(answerReply("closed", "disputed")).toContain("closed");
    expect(answerReply("ok", "disputed")).toContain("Loans tab");
  });

  it("announces closed loans and keeps a miss private", () => {
    expect(returnReply("a", "b", false, [{ loan_id: 1, cards: 3 }, { loan_id: 2, cards: 1 }])).toEqual({
      content: "<@a> and <@b> closed 2 loans: the cards are back with their owner.\n- Loan #1: 3 cards\n- Loan #2: 1 card",
      announce: true,
    });
    expect(returnReply("a", "b", true, [])).toMatchObject({ announce: false });
    expect(returnReply("a", "b", true, [{ loan_id: 1, cards: 40 }]).content).toContain("wrote off a loan");
  });
});
