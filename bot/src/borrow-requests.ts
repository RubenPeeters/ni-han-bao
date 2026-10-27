// Borrow requests (#299): a member asks a lender for cards on the site, the bot DMs the lender
// with Accept and Decline, and the borrower once with the answer. A request is not a loan:
// Accept records one through accept_riftbound_borrow_request(), with copies picked as /lend does.

import { createHash } from "node:crypto";
import { ButtonStyle, ComponentType, type APIButtonComponent } from "discord.js";
import { languageName } from "./collection.js";
import { type Emojis } from "./emojis.js";
import { pickCopies, type CopyRow, type LoanCard, type Wanted } from "./lend-copies.js";
import { loanCards, loanMessage } from "./lending.js";
import { type Catalogue } from "./riftbound.js";
import { type V2 } from "./riftbound-reply.js";
import { escapeMarkdown } from "./stores.js";

/** A request as the bot reads it from the database. */
export interface BorrowRequest {
  id: number;
  borrower: string;
  lender: string;
  languages: string[];
  wanted_by: string | null;
  note: string | null;
  cards: { card_id: string; quantity: number }[];
  state: "open" | "accepted" | "declined" | "cancelled";
  loan_id: number | null;
  /** The lender's reason, on a decline. */
  answer_note: string | null;
}

export const NOT_LENDER = "Only the member who was asked can answer this.";

const CLOSED: Record<Exclude<BorrowRequest["state"], "open">, string> = {
  accepted: "You accepted this request already.",
  declined: "You declined this request already.",
  cancelled: "They cancelled this request.",
};

/** Why `member` cannot answer the request, or null when they can. */
export function cannotAnswer(request: BorrowRequest, member: string): string | null {
  if (member !== request.lender) return NOT_LENDER;
  return request.state === "open" ? null : CLOSED[request.state];
}

/**
 * Accept: which copies the loan takes, from the lender's riftbound_lend_options() rows, in the
 * request's languages, those available to lend first. Or why it cannot be accepted.
 */
export function acceptPick(
  catalogue: Pick<Catalogue, "cards">,
  request: BorrowRequest,
  member: string,
  rows: CopyRow[],
): { cards: LoanCard[]; unmarked: number } | string {
  const no = cannotAnswer(request, member);
  if (no) return no;
  const wanted: Wanted[] = [];
  for (const { card_id, quantity } of request.cards) {
    const card = catalogue.cards.find((c) => c.id === card_id);
    if (!card) return "A card of this request is no longer in the catalogue.";
    wanted.push({ card, count: quantity });
  }
  return pickCopies(rows, wanted, request.languages);
}

/** The lender's reply when accept_riftbound_borrow_request() raised one of its reasons. */
export function acceptError(message: string): string | null {
  if (message === "not_lender") return NOT_LENDER;
  if (message === "closed") return "This request was answered or cancelled meanwhile.";
  if (message === "forgotten") return "One of you asked to be forgotten, so nothing was recorded.";
  if (message.startsWith("only the owner lends")) return "Those copies are no longer in hand: press Accept again.";
  return null;
}

/** The lender's reply after decline_riftbound_borrow_request(). */
export function declineReply(result: string): string {
  if (result === "not_lender") return NOT_LENDER;
  if (result === "closed") return "This request was answered or cancelled meanwhile.";
  return "Declined. They get a message from me.";
}

const ACCEPT_ID = /^borrow-(accept|decline|confirm):(\d+)(?::([0-9a-f]+))?$/;
const DECLINE_FORM_ID = /^borrow-decline-form:(\d+)$/;

/** Confirm carries the previewed pick's key, so it records only the copies the lender saw. */
export const requestButtonId = (kind: "accept" | "decline" | "confirm", request: number, pick?: string) =>
  `borrow-${kind}:${request}${pick ? `:${pick}` : ""}`;
export function parseRequestButtonId(customId: string): { kind: "accept" | "decline" | "confirm"; request: number; pick: string | null } | null {
  const m = ACCEPT_ID.exec(customId);
  return m ? { kind: m[1] as "accept" | "decline" | "confirm", request: Number(m[2]), pick: m[3] ?? null } : null;
}
/** A short fingerprint of the copies picked; pickCopies() orders them, so the same pick has the same key. */
export const pickKey = (cards: LoanCard[]) => createHash("sha256").update(JSON.stringify(cards)).digest("hex").slice(0, 16);
export const declineFormId = (request: number) => `borrow-decline-form:${request}`;
export function parseDeclineFormId(customId: string): number | null {
  const m = DECLINE_FORM_ID.exec(customId);
  return m ? Number(m[1]) : null;
}

// One printing per card, for its picture: requests name cards, not copies.
const rowsOf = (catalogue: Catalogue, cards: { card_id: string; quantity: number }[]) =>
  cards.map((c) => ({ printing_id: catalogue.printings.find((p) => p.card_id === c.card_id)?.id ?? c.card_id, quantity: c.quantity }));

const quote = (note: string) => note.split("\n").map((l) => `> ${escapeMarkdown(l)}`).join("\n");

function requestNotes(request: BorrowRequest): string[] {
  return [
    `Languages: ${request.languages.map(languageName).join(", ")}`,
    request.wanted_by && `Wanted by ${request.wanted_by}`,
    request.note && quote(request.note),
  ].filter((n): n is string => !!n);
}

const button = (custom_id: string, label: string, style: ButtonStyle.Success | ButtonStyle.Secondary): APIButtonComponent =>
  ({ type: ComponentType.Button, custom_id, label, style });

/** The DM to the lender, once per request. */
export function requestDm(catalogue: Catalogue, emojis: Emojis, request: BorrowRequest): V2 {
  return loanMessage(
    `### Borrow request #${request.id}\n<@${request.borrower}> asks to borrow`,
    loanCards(catalogue, emojis, { id: request.id, lender: request.lender, borrower: request.borrower, due: null, rows: rowsOf(catalogue, request.cards), deck: null }),
    [...requestNotes(request), "Accept to pick your copies and record the loan; also on your loans page."],
    [{
      type: ComponentType.ActionRow,
      components: [
        button(requestButtonId("accept", request.id), "Accept", ButtonStyle.Success),
        button(requestButtonId("decline", request.id), "Decline", ButtonStyle.Secondary),
      ],
    }],
  );
}

/** What Accept shows the lender before the loan is recorded: the copies picked, and Confirm. `changed`: Confirm found a different pick. */
export function acceptPreview(
  catalogue: Catalogue,
  emojis: Emojis,
  request: BorrowRequest,
  picked: { cards: LoanCard[]; unmarked: number },
  changed = false,
): V2 {
  const languages = [...new Set(picked.cards.map((c) => c.language))].map(languageName).join(", ");
  return loanMessage(
    `### Lend these to <@${request.borrower}>?\nFor borrow request #${request.id}, in ${languages}`,
    loanCards(catalogue, emojis, { id: request.id, lender: request.lender, borrower: request.borrower, due: null, rows: picked.cards, deck: null }),
    [
      changed && "Your copies changed since you pressed Accept, so nothing was recorded: these are the copies Confirm takes now.",
      picked.unmarked > 0 &&
        `Heads-up: ${picked.unmarked} of these copies ${picked.unmarked === 1 ? "is" : "are"} not marked to lend, or held by a deck not for lending.`,
      "Confirm records the loan; they confirm they got the cards, as after /lend.",
    ].filter((n): n is string => !!n),
    [{ type: ComponentType.ActionRow, components: [button(requestButtonId("confirm", request.id, pickKey(picked.cards)), "Confirm", ButtonStyle.Success)] }],
  );
}

/** The one DM to the borrower once the lender answered. */
export function answerDm(catalogue: Catalogue, emojis: Emojis, request: BorrowRequest, siteUrl: string | null): V2 {
  const accepted = request.state === "accepted";
  const where = siteUrl ? `${siteUrl}/loans` : "your loans page";
  return loanMessage(
    accepted
      ? `### <@${request.lender}> accepted borrow request #${request.id}\nRecorded as loan #${request.loan_id}`
      : `### <@${request.lender}> declined borrow request #${request.id}`,
    loanCards(catalogue, emojis, { id: request.id, lender: request.lender, borrower: request.borrower, due: null, rows: rowsOf(catalogue, request.cards), deck: null }),
    accepted
      ? [`Once you have the cards, confirm it on ${where}.`]
      : request.answer_note ? [quote(request.answer_note)] : [],
  );
}
