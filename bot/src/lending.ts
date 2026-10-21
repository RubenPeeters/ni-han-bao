// /lend and /return (#172): single Riftbound cards lent between members, kept in an
// append-only ledger in the database (riftbound_loans). Lending moves possession, never
// ownership: the lender's collection keeps counting the copies.

import {
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
} from "discord.js";
import type { Card } from "./card-match.js";
import type { Emojis } from "./emojis.js";
import { deckWanted, pickCopies, type CopyRow, type LoanCard, type Wanted } from "./lend-copies.js";
import { cardChoices, cardMiss, choiceLabel, lookupCard, type Catalogue } from "./riftbound.js";
import { cardImage, cardLine, fitLines, MAX_TEXT, withThumbnail, type V2 } from "./riftbound-reply.js";
import { escapeMarkdown } from "./stores.js";

export { deckWanted, pickCopies, type CopyRow, type LoanCard, type Wanted };

export const LEND_COMMAND = {
  name: "lend",
  description: "Record Riftbound cards you lend to a member",
  options: [
    {
      type: ApplicationCommandOptionType.User,
      name: "member",
      description: "Who borrows them",
      required: true,
    },
    {
      type: ApplicationCommandOptionType.String,
      name: "cards",
      description: "The cards, separated by ; with a count if more than one: 2 Jinx; Ahri",
      autocomplete: true,
    },
    {
      type: ApplicationCommandOptionType.String,
      name: "deck",
      description: "Or one of your decks, lent whole as one loan",
      autocomplete: true,
    },
    {
      type: ApplicationCommandOptionType.String,
      name: "due",
      description: "When you want them back, like 2026-11-02",
    },
    {
      type: ApplicationCommandOptionType.Integer,
      name: "fixes",
      description: "The number of a loan of yours this one corrects; that loan stops counting",
      min_value: 1,
    },
  ],
} as const;

export const RETURN_COMMAND = {
  name: "return",
  description: "Record that lent Riftbound cards are back with their owner",
  options: [
    {
      type: ApplicationCommandOptionType.User,
      name: "member",
      description: "The other member of the loan, lender or borrower",
      required: true,
    },
    {
      type: ApplicationCommandOptionType.Integer,
      name: "loan",
      description: "Only this loan (every open loan between you two if left out)",
      min_value: 1,
    },
    {
      type: ApplicationCommandOptionType.Boolean,
      name: "lost",
      description: "The cards are lost: write off your loan instead (the owner only)",
    },
  ],
} as const;

// "2 Jinx", "2x Jinx" or "Jinx x2". Card names have commas ("Ahri, ..."), so items split on ;.
const COUNT_FIRST = /^(\d{1,2})\s*[x×]?\s+(\S.*)$/i;
const COUNT_LAST = /^(.*\S)\s+[x×](\d{1,2})$/i;

/** A typed name or code, a picked suggestion's label ("Jinx (Unit)"), or a card id. */
function findCard(catalogue: Catalogue, text: string) {
  const found = lookupCard(catalogue, text);
  if (found) return found;
  const card = catalogue.cards.find((c) => choiceLabel(c) === text);
  return card ? { card } : null;
}

/** The /lend cards option to cards and counts, or what is wrong with it. */
export function parseCards(catalogue: Catalogue, text: string): Wanted[] | string {
  const wanted = new Map<string, Wanted>();
  for (const item of text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const first = COUNT_FIRST.exec(item);
    const last = first ? null : COUNT_LAST.exec(item);
    const name = first?.[2] ?? last?.[1] ?? item;
    const count = Number(first?.[1] ?? last?.[2] ?? 1);
    const found = findCard(catalogue, name);
    if (!found || !("card" in found)) return cardMiss(name, found?.ambiguous ?? null);
    if (count < 1) return `Lend at least 1 × ${found.card.name}.`;
    const seen = wanted.get(found.card.id);
    wanted.set(found.card.id, { card: found.card, count: (seen?.count ?? 0) + count });
  }
  return wanted.size ? [...wanted.values()] : "Name at least one card.";
}

/** Autocomplete for the cards option: the last item completed, the items before it kept. */
export function lendChoices(catalogue: Catalogue, typed: string): { name: string; value: string }[] {
  const cut = typed.lastIndexOf(";") + 1;
  const head = typed.slice(0, cut).trim();
  const last = typed.slice(cut).trim();
  const count = /^(\d{1,2})\s*[x×]?\s+/i.exec(last);
  const prefix = (head ? `${head} ` : "") + (count ? `${count[1]} ` : "");
  return cardChoices(catalogue, count ? last.slice(count[0].length) : last)
    .map((c) => prefix + c.name)
    // Discord's limit; past it the member types the rest.
    .filter((v) => v.length <= 100)
    .map((v) => ({ name: v, value: v }));
}

/** The due option, as a date that is today (UTC) or later; null without one. Or why not. */
export function parseDue(text: string | null, today: string): { due: string | null } | string {
  if (!text?.trim()) return { due: null };
  const typed = text.trim();
  const usage = "Give the due date like 2026-11-02.";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typed);
  if (!m) return usage;
  // Date.UTC rolls over (Feb 30 is Mar 2), so a changed date means it was not a real one.
  const iso = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10);
  if (iso !== typed) return usage;
  if (iso < today) return "That date has already passed.";
  return { due: iso };
}

/** The /lend options, cards or a deck: exactly one of them. */
export function lendWhat(cards: string | null, deck: string | null): { cards: string } | { deck: string } | string {
  if (cards?.trim() && deck?.trim()) return "Lend cards or a deck, not both: run /lend once for each.";
  if (deck?.trim()) return { deck: deck.trim() };
  if (cards?.trim()) return { cards };
  return "Name the cards to lend, or pick one of your decks.";
}

/** Autocomplete for the deck option: the lender's decks by name, a deck's id as its value. */
export function deckChoices(decks: { id: string; name: string }[], typed: string): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  return decks
    .filter((d) => d.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((d) => ({ name: d.name, value: d.id }));
}

/** A loan as its replies show it: a deck lent whole by its name, with its Legend's picture where known. */
export interface LoanView {
  loan: number;
  lender: string;
  borrower: string;
  cards: Wanted[];
  due: string | null;
  deck: { name: string; legend: Card | null } | null;
}

/** What a loan lent: a deck by its name and size (its list is long), else the number of cards. */
function lentText(view: LoanView): string {
  const n = view.cards.reduce((sum, w) => sum + w.count, 0);
  const cards = `${n} ${n === 1 ? "card" : "cards"}`;
  return view.deck ? `the deck **${escapeMarkdown(view.deck.name)}** (${cards})` : cards;
}

// Up to this many cards are shown with their pictures; past it, as lines.
const PICTURED = 2;

/** The loan's heading, then each card as a line with its domains; the deck's Legend or a few cards pictured. */
function loanComponents(view: LoanView, catalogue: Pick<Catalogue, "printings">, emojis: Emojis, heading: string, notes: string[]): APIComponentInContainer[] {
  const head = `${heading}\n<@${view.lender}> lent <@${view.borrower}> ${lentText(view)} · ${view.due ? `due ${view.due}` : "no due date"}`;
  const legend = view.deck?.legend ?? null;
  const top = withThumbnail(head, legend && cardImage(catalogue, legend, 160), legend?.name ?? "");
  const lines = view.cards.map((w) => cardLine(w.count, w.card, emojis));
  const rest = notes.map((content) => ({ type: ComponentType.TextDisplay as const, content }));
  if (!view.deck && view.cards.length <= PICTURED) {
    return [top, ...view.cards.map((w, i) => withThumbnail(lines[i], cardImage(catalogue, w.card, 160), w.card.name)), ...rest];
  }
  // Picture descriptions count towards the limit too.
  const budget = MAX_TEXT - head.length - notes.join("").length - 200;
  return [top, { type: ComponentType.TextDisplay, content: fitLines(lines, budget, null) }, ...rest];
}

const v2 = (components: APIMessageTopLevelComponent[]): V2 => ({ components, flags: MessageFlags.IsComponentsV2 });
const container = (components: APIComponentInContainer[]): APIMessageTopLevelComponent => ({ type: ComponentType.Container, components });

/** The ledger's rows of a loan as cards and counts, from the catalogue. */
export function loanCards(catalogue: Catalogue, rows: { printing_id: string; quantity: number }[]): Wanted[] {
  const cards = new Map<string, Wanted>();
  for (const r of rows) {
    const printing = catalogue.printings.find((p) => p.id === r.printing_id);
    const card = catalogue.cards.find((c) => c.id === printing?.card_id) ?? {
      id: r.printing_id, name: printing?.collector_code ?? r.printing_id, type: "", supertypes: [], domains: [],
      energy: null, might: null, tags: [], rules_text: null, placeholder: true,
    };
    const seen = cards.get(card.id);
    cards.set(card.id, { card, count: (seen?.count ?? 0) + r.quantity });
  }
  return [...cards.values()];
}

/** What only the lender sees after /lend. */
export function lendReceipt(view: LoanView, unmarked: number, fixes: number | null, catalogue: Pick<Catalogue, "printings">, emojis: Emojis): V2 {
  const notes = [
    fixes !== null && `Loan #${fixes} no longer counts.`,
    unmarked > 0 &&
      `Heads-up: ${unmarked} of these copies ${unmarked === 1 ? "is" : "are"} not marked to lend, or held by a deck not for lending. Lent anyway; mark what you lend with To lend on the Cards page or /collection lending.`,
  ].filter((n): n is string => !!n);
  return v2([container(loanComponents(view, catalogue, emojis, `### Recorded loan #${view.loan}`, notes.map((n) => `-# ${n}`)))]);
}

/** The channel message the borrower answers with Confirm or Dispute. */
export function lendAnnouncement(view: LoanView, catalogue: Pick<Catalogue, "printings">, emojis: Emojis): V2 {
  return v2([
    container(loanComponents(view, catalogue, emojis, `### Loan #${view.loan}`, [`<@${view.borrower}>, did you get them?`])),
    {
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, custom_id: answerId("confirm", view.loan, view.borrower), label: "Confirm", style: ButtonStyle.Success },
        { type: ComponentType.Button, custom_id: answerId("dispute", view.loan, view.borrower), label: "Dispute", style: ButtonStyle.Secondary },
      ],
    },
  ]);
}

/** The due-date DM to the borrower. */
export function nudgeMessage(view: LoanView, catalogue: Pick<Catalogue, "printings">, emojis: Emojis): V2 {
  return v2([container(loanComponents(view, catalogue, emojis, `### Loan #${view.loan} is due`, ["Give the cards back, then record it with /return."]))]);
}

const ANSWER_ID = /^loan-(confirm|dispute):(\d+):(\d+)$/;
const DISPUTE_FORM_ID = /^loan-dispute-form:(\d+)$/;

/** Button ids carry the borrower, so anyone else is turned away before a form opens. */
export const answerId = (kind: "confirm" | "dispute", loan: number, borrower: string) => `loan-${kind}:${loan}:${borrower}`;
export function parseAnswerId(customId: string): { kind: "confirmed" | "disputed"; loan: number; borrower: string } | null {
  const m = ANSWER_ID.exec(customId);
  return m ? { kind: m[1] === "confirm" ? "confirmed" : "disputed", loan: Number(m[2]), borrower: m[3] } : null;
}
export const disputeFormId = (loan: number) => `loan-dispute-form:${loan}`;
export function parseDisputeFormId(customId: string): number | null {
  const m = DISPUTE_FORM_ID.exec(customId);
  return m ? Number(m[1]) : null;
}

export const NOT_BORROWER = "Only the borrower can answer this.";

/** The borrower's reply after answer_riftbound_loan(). */
export function answerReply(result: string, kind: "confirmed" | "disputed"): string {
  if (result === "not_borrower") return NOT_BORROWER;
  if (result === "closed") return "That loan is closed or was corrected; nothing to answer.";
  if (result === "unchanged") return "You confirmed it already.";
  return kind === "confirmed"
    ? "Confirmed: you have the cards. Change your mind with Dispute."
    : "Disputed. The lender sees your side on the Loans tab of your profiles, and can correct the loan with /lend fixes.";
}

/** /return: who sees what, a line per loan with its number of cards. A closed loan is announced, so the other member knows. */
export function returnReply(
  me: string,
  other: string,
  lost: boolean,
  closed: { loan_id: number; cards: number }[],
): { content: string; announce: boolean } {
  if (closed.length === 0) {
    return {
      content: lost
        ? `None of your cards are out with <@${other}> on an open loan. Only the owner writes off cards.`
        : `No open loan between you and <@${other}>.`,
      announce: false,
    };
  }
  const lines = closed.map((c) => `- Loan #${c.loan_id}: ${c.cards} ${c.cards === 1 ? "card" : "cards"}`);
  const loans = closed.length === 1 ? "a loan" : `${closed.length} loans`;
  const head = lost
    ? `<@${me}> wrote off ${loans}: the cards <@${other}> borrowed are lost. Remove them from your collection on the Cards page if they are gone for good.`
    : `<@${me}> and <@${other}> closed ${loans}: the cards are back with their owner.`;
  return { content: [head, ...lines].join("\n"), announce: true };
}
