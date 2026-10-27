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
  type LoanView,
  type Wanted,
} from "./lending.js";
import { ComponentType } from "discord.js";
import { heldByLanguage } from "./lend-copies.js";
import { choiceLabel, type Catalogue } from "./riftbound.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const unit = catalogue.cards.find((c) => c.id === "ahri-alluring")!;
const legend = catalogue.cards.find((c) => c.id === "nine-tailed-fox")!;
const none = new Map<string, string>();
const loan: LoanView = { id: 7, lender: "a", borrower: "b", due: "2026-11-02", rows: [{ printing_id: "ogn-255-298", quantity: 2 }], deck: null };

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
    holds: [],
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
    const holds = [{ language: "en", copies: 3 }];
    const rows = [row({ finish: "foil", quantity: 2, lendable: 2, holds }), row({ quantity: 2, lendable: 2, holds })];
    // 4 in hand, 3 held: 1 is still available to lend.
    expect(pickCopies(rows, [{ card: unit, count: 1 }])).toMatchObject({ unmarked: 0 });
    expect(pickCopies(rows, [{ card: unit, count: 3 }])).toMatchObject({ unmarked: 2 });
    expect(pickCopies([row({ lendable: 2, holds: [{ language: "en", copies: 9 }] })], [{ card: unit, count: 1 }])).toMatchObject({ unmarked: 1 });
  });

  it("lends the copies in a language the decks not for lending do not hold first", () => {
    // 2 EN and 1 FR, all to lend, an English deck holds 1: the free ones are 1 EN and the FR.
    const holds = [{ language: "en", copies: 1 }];
    const rows = [row({ language: "en", lendable: 2, holds }), row({ language: "fr", quantity: 1, lendable: 1, holds })];
    expect(pickCopies(rows, [{ card: unit, count: 2 }])).toEqual({
      cards: [
        { printing_id: "ogn-066-298", finish: "normal", condition: "NM", language: "en", quantity: 1 },
        { printing_id: "ogn-066-298", finish: "normal", condition: "NM", language: "fr", quantity: 1 },
      ],
      unmarked: 0,
    });
  });

  it("refuses copies the lender does not have in hand", () => {
    expect(pickCopies([row({ quantity: 2, lent: 1 })], [{ card: unit, count: 2 }])).toContain("only 1");
    expect(pickCopies([], [{ card: legend, count: 1 }])).toContain("no ");
  });

  it("takes only the pinned printing when one is wanted", () => {
    const rows = [row({ printing_id: "a" }), row({ printing_id: "b" })];
    expect(pickCopies(rows, [{ card: unit, count: 1, printing: "b" }])).toMatchObject({ cards: [{ printing_id: "b", quantity: 1 }] });
    expect(pickCopies(rows, [{ card: unit, count: 3, printing: "b" }])).toContain("in the deck's printing");
  });
});

describe("heldByLanguage", () => {
  it("holds a deck's copies in its own language first", () => {
    // Firestorm (#296): 2 EN and 1 FR, an English deck holds 1.
    expect(heldByLanguage({ en: 2, fr: 1 }, [{ language: "en", copies: 1 }])).toEqual({ en: 1 });
    expect(heldByLanguage({ en: 2, fr: 1 }, [{ language: "fr", copies: 1 }])).toEqual({ fr: 1 });
  });

  it("holds the rest in en, fr, zh-Hans order once the deck's own language runs out", () => {
    expect(heldByLanguage({ "zh-Hans": 2, fr: 2, en: 1 }, [{ language: "zh-Hans", copies: 4 }])).toEqual({ "zh-Hans": 2, en: 1, fr: 1 });
    // A deck in a language the owner has no copies of.
    expect(heldByLanguage({ fr: 1, "zh-Hans": 3 }, [{ language: "en", copies: 2 }])).toEqual({ en: 0, fr: 1, "zh-Hans": 1 });
  });

  it("serves every deck's own language before any spills over, and never holds more than in hand", () => {
    expect(heldByLanguage({ en: 1, fr: 1 }, [{ language: "en", copies: 2 }, { language: "fr", copies: 1 }])).toEqual({ en: 1, fr: 1 });
    expect(heldByLanguage({ en: 1 }, [{ language: "en", copies: 5 }])).toEqual({ en: 1 });
    expect(heldByLanguage({ en: 2 }, [])).toEqual({});
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
    expect((deckWanted(catalogue, { legend_id: legend.id, legend_printing_id: "p", entries: [] }) as Wanted[])[0].printing).toBe("p");
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

  it("names the deck instead of its card list, with its Legend's picture", () => {
    const deck: LoanView = { ...loan, rows: [{ printing_id: "ogn-066-298", quantity: 3 }, { printing_id: "ogn-255-298", quantity: 1 }], deck: "Ahri control" };
    expect(loanCards(catalogue, none, deck)).toMatchObject([
      { type: ComponentType.Section, components: [{ content: "The deck **Ahri control** · 4 cards" }], accessory: { description: legend.name } },
    ]);
  });
});

describe("replies", () => {
  it("shows one or two cards with their pictures and domains, as words without the emojis", () => {
    const cards = loanCards(catalogue, new Map([["rb_calm", "5"]]), loan);
    expect(cards).toMatchObject([
      { type: ComponentType.Section, components: [{ content: `2× **${legend.name}** · <:rb_calm:5> ${legend.domains[1]}` }], accessory: { type: ComponentType.Thumbnail } },
    ]);
    // Two rows of one card are one line.
    const twice = loanCards(catalogue, none, { ...loan, rows: [{ printing_id: "ogn-066-298", quantity: 1 }, { printing_id: "ogn-066a-298", quantity: 1 }] });
    expect(twice).toHaveLength(1);
    expect(JSON.stringify(twice)).toContain(`2× **${unit.name}**`);
  });

  it("lists three or more cards as lines, without pictures", () => {
    const rows = ["ogn-066-298", "ogn-255-298", "ogn-030-298"].map((printing_id) => ({ printing_id, quantity: 1 }));
    const cards = loanCards(catalogue, none, { ...loan, rows });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: ComponentType.TextDisplay });
    expect((cards[0] as { content: string }).content.split("\n")).toHaveLength(3);
  });

  it("names the lender, borrower and due date, and keeps Confirm and Dispute for the borrower", () => {
    const message = lendAnnouncement(catalogue, none, loan);
    const text = JSON.stringify(message);
    expect(text).toContain("### Loan #7\\n<@a> lent <@b> · due 2026-11-02");
    expect(text).toContain("<@b>, did you get them?");
    expect(message.components[1]).toMatchObject({
      type: ComponentType.ActionRow,
      components: [{ custom_id: answerId("confirm", 7, "b"), label: "Confirm" }, { custom_id: answerId("dispute", 7, "b"), label: "Dispute" }],
    });
    expect(JSON.stringify(nudgeMessage(catalogue, none, loan))).toContain("Loan #7 is due");
  });

  it("warns the lender about copies not marked to lend, and names a corrected loan", () => {
    const receipt = JSON.stringify(lendReceipt(catalogue, none, loan, 1, 3));
    expect(receipt).toContain("Loan #7 recorded");
    expect(receipt).toContain("#3 no longer counts");
    expect(receipt).toContain("1 of these copies is not marked");
    expect(JSON.stringify(lendReceipt(catalogue, none, loan, 0, null))).not.toContain("Heads-up");
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
    expect(returnReply("a", "b", false, [{ loan_id: 1, cards: 1 }, { loan_id: 2, cards: 40 }])).toEqual({
      content: "Closed between <@a> and <@b>: the cards are back with their owner.\n- Loan #1: 1 card\n- Loan #2: 40 cards",
      announce: true,
    });
    expect(returnReply("a", "b", true, [])).toMatchObject({ announce: false });
    expect(returnReply("a", "b", true, [{ loan_id: 1, cards: 2 }]).content).toContain("wrote off what <@b> borrowed: the cards are lost");
  });
});
