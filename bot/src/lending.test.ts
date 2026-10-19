import { describe, expect, it } from "vitest";
import {
  answerId,
  answerReply,
  lendChoices,
  lendReceipt,
  loanCardList,
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
import { choiceLabel, placeholderCatalogue } from "./riftbound.js";

const catalogue = placeholderCatalogue([{ id: "Ahri", key: "103", name: "Ahri" }]);
const unit = catalogue.cards.find((c) => c.id === "placeholder-unit-ahri")!;
const legend = catalogue.cards.find((c) => c.id === "placeholder-legend-ahri")!;

describe("parseCards", () => {
  it("reads counts before or after a name, and adds up a card named twice", () => {
    const parsed = parseCards(catalogue, `2 ${unit.name}; PLH-L103 x2;1x plh-l103`) as Wanted[];
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
    expect(parseCards(catalogue, "0 PLH-L103")).toContain("at least 1");
  });
});

describe("lendChoices", () => {
  it("completes the last card and keeps the ones before it with their counts", () => {
    const choices = lendChoices(catalogue, "2 PLH-L103; 3 ahri, ");
    expect(choices.map((c) => c.value)).toContain(`2 PLH-L103; 3 ${choiceLabel(unit)}`);
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
    printing_id: "PLH-U103",
    finish: "normal",
    condition: "NM",
    language: "en",
    quantity: 2,
    lendable: 0,
    lent: 0,
    ...over,
  });

  it("takes copies available to lend first, then the rest with a warning", () => {
    const rows = [row({ finish: "foil", quantity: 3, lendable: 0 }), row({ quantity: 2, lendable: 2, lent: 1 })];
    expect(pickCopies(rows, [{ card: unit, count: 3 }])).toEqual({
      cards: [
        { printing_id: "PLH-U103", finish: "foil", condition: "NM", language: "en", quantity: 2 },
        { printing_id: "PLH-U103", finish: "normal", condition: "NM", language: "en", quantity: 1 },
      ],
      unmarked: 2,
    });
  });

  it("does not warn when the copies are available to lend", () => {
    expect(pickCopies([row({ lendable: 2 })], [{ card: unit, count: 2 }])).toMatchObject({ unmarked: 0 });
  });

  it("refuses copies the lender does not have in hand", () => {
    expect(pickCopies([row({ quantity: 2, lent: 1 })], [{ card: unit, count: 2 }])).toContain("only 1");
    expect(pickCopies([], [{ card: legend, count: 1 }])).toContain("no ");
  });
});

describe("replies", () => {
  it("names the cards of a loan from the catalogue", () => {
    expect(loanCardList(catalogue, [{ printing_id: "PLH-L103", quantity: 2 }])).toBe(`2 × ${legend.name}`);
  });

  it("warns the lender about copies not marked to lend, and names a corrected loan", () => {
    const receipt = lendReceipt(7, [{ card: legend, count: 1 }], 1, 3);
    expect(receipt).toContain("loan #7");
    expect(receipt).toContain("#3 no longer counts");
    expect(receipt).toContain("1 of these copies is not marked");
    expect(lendReceipt(7, [{ card: legend, count: 1 }], 0, null)).not.toContain("Heads-up");
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
    expect(returnReply("a", "b", false, [{ loan_id: 1 }, { loan_id: 2 }])).toEqual({
      content: "Loans #1, #2 between <@a> and <@b> are closed: the cards are back with their owner.",
      announce: true,
    });
    expect(returnReply("a", "b", true, [])).toMatchObject({ announce: false });
    expect(returnReply("a", "b", true, [{ loan_id: 1 }]).content).toContain("wrote off loan #1");
  });
});
