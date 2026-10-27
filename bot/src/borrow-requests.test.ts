import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ComponentType } from "discord.js";
import {
  acceptError,
  acceptPick,
  acceptPreview,
  answerDm,
  cannotAnswer,
  declineFormId,
  declineReply,
  NOT_LENDER,
  parseDeclineFormId,
  parseRequestButtonId,
  pickKey,
  requestButtonId,
  requestDm,
  type BorrowRequest,
} from "./borrow-requests.js";
import type { CopyRow } from "./lend-copies.js";
import type { Catalogue } from "./riftbound.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const none = new Map<string, string>();
const request: BorrowRequest = {
  id: 4,
  borrower: "bob",
  lender: "ruben",
  languages: ["en"],
  wanted_by: "2026-11-02",
  note: "For Friday's *event*",
  cards: [{ card_id: "nine-tailed-fox", quantity: 1 }],
  state: "open",
  loan_id: null,
  answer_note: null,
};
const row = (over: Partial<CopyRow>): CopyRow => ({
  card_id: "nine-tailed-fox",
  printing_id: "ogn-255-298",
  finish: "normal",
  condition: "NM",
  language: "en",
  quantity: 1,
  lendable: 1,
  lent: 0,
  holds: [],
  ...over,
});
const texts = (message: { components: unknown[] }) => JSON.stringify(message.components);

describe("cannotAnswer", () => {
  it("lets only the lender answer an open request", () => {
    expect(cannotAnswer(request, "ruben")).toBeNull();
    expect(cannotAnswer(request, "bob")).toBe(NOT_LENDER);
    expect(cannotAnswer({ ...request, state: "cancelled" }, "ruben")).toBe("They cancelled this request.");
    expect(cannotAnswer({ ...request, state: "accepted" }, "ruben")).toBe("You accepted this request already.");
  });
});

describe("acceptPick", () => {
  it("picks copies in the accepted languages only, available to lend first", () => {
    const rows = [row({ language: "fr", lendable: 1 }), row({ finish: "foil", lendable: 0 }), row({ lendable: 1 })];
    expect(acceptPick(catalogue, request, "ruben", rows)).toEqual({
      cards: [{ printing_id: "ogn-255-298", finish: "normal", condition: "NM", language: "en", quantity: 1 }],
      unmarked: 0,
    });
  });

  it("says so when the accepted languages have too few copies", () => {
    expect(acceptPick(catalogue, request, "ruben", [row({ language: "fr" })])).toMatch(/no Nine-Tailed Fox in the languages they accept/);
  });

  it("counts a deck's held copies of another language against that language, not the accepted one", () => {
    // 1 EN, 1 FR, an English deck not for lending holds 1: the FR copy is still available to lend.
    const holds = [{ language: "en", copies: 1 }];
    const fr = { ...request, languages: ["fr"] };
    expect(acceptPick(catalogue, fr, "ruben", [row({ holds }), row({ language: "fr", holds })])).toMatchObject({ unmarked: 0 });
  });

  it("refuses anyone but the lender, and a closed request", () => {
    expect(acceptPick(catalogue, request, "bob", [row({})])).toBe(NOT_LENDER);
    expect(acceptPick(catalogue, { ...request, state: "declined" }, "ruben", [row({})])).toBe("You declined this request already.");
  });
});

describe("replies", () => {
  it("maps the database's reasons", () => {
    expect(acceptError("closed")).toMatch(/meanwhile/);
    expect(acceptError("something else")).toBeNull();
    expect(declineReply("ok")).toMatch(/^Declined/);
    expect(declineReply("not_lender")).toBe(NOT_LENDER);
  });

  it("round-trips the button and form ids", () => {
    expect(parseRequestButtonId(requestButtonId("accept", 12))).toEqual({ kind: "accept", request: 12, pick: null });
    expect(parseRequestButtonId(requestButtonId("confirm", 12, "00ff"))).toEqual({ kind: "confirm", request: 12, pick: "00ff" });
    expect(parseRequestButtonId("loan-confirm:1:2")).toBeNull();
    expect(parseDeclineFormId(declineFormId(12))).toBe(12);
  });
});

describe("messages", () => {
  it("DMs the lender who asks, the card with its picture, the languages, date and note, and Accept and Decline", () => {
    const dm = requestDm(catalogue, none, request);
    const all = texts(dm);
    expect(all).toContain("<@bob> asks to borrow");
    expect(all).toContain("Nine-Tailed Fox");
    expect(all).toContain("Languages: English");
    expect(all).toContain("Wanted by 2026-11-02");
    expect(all).toContain("> For Friday's \\\\*event\\\\*");
    const row = dm.components.find((c) => c.type === ComponentType.ActionRow) as { components: { custom_id: string }[] };
    expect(row.components.map((b) => b.custom_id)).toEqual(["borrow-accept:4", "borrow-decline:4"]);
    expect(all).toContain(`"type":${ComponentType.Thumbnail}`);
  });

  it("previews the picked copies with Confirm", () => {
    const cards = [{ printing_id: "ogn-255-298", finish: "normal", condition: "NM", language: "fr", quantity: 1 }];
    const all = texts(acceptPreview(catalogue, none, request, { cards, unmarked: 1 }));
    expect(all).toContain("in French");
    expect(all).toContain("1 of these copies is not marked to lend");
    expect(all).toContain(`borrow-confirm:4:${pickKey(cards)}`);
    expect(all).not.toContain("changed since");
    expect(texts(acceptPreview(catalogue, none, request, { cards, unmarked: 0 }, true))).toContain("changed since you pressed Accept");
  });

  it("keys a pick by its copies, so Confirm notices a changed one", () => {
    const cards = [{ printing_id: "ogn-255-298", finish: "normal", condition: "NM", language: "fr", quantity: 1 }];
    expect(pickKey(cards)).toBe(pickKey(structuredClone(cards)));
    expect(pickKey(cards)).not.toBe(pickKey([{ ...cards[0], finish: "foil" }]));
  });

  it("tells the borrower the answer: the loan, or the reason", () => {
    expect(texts(answerDm(catalogue, none, { ...request, state: "accepted", loan_id: 9 }, "https://x"))).toContain("Recorded as loan #9");
    const declined = texts(answerDm(catalogue, none, { ...request, state: "declined", answer_note: "Lent out" }, null));
    expect(declined).toContain("declined borrow request #4");
    expect(declined).toContain("> Lent out");
  });
});
