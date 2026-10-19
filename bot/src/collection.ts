// /collection (#150): quick entry at a table, and the "I lend cards" switch. The website's
// Cards grid is the full editor; both write riftbound_collection and riftbound_lending.

import { ApplicationCommandOptionType } from "discord.js";
import { cardMiss, lookupCard, type Catalogue } from "./riftbound.js";

export const LEND_DEFAULTS = {
  nothing: "Nothing until I mark cards",
  everything: "Everything I own, except decks marked not for lending",
} as const;
export type LendDefault = keyof typeof LEND_DEFAULTS;

export const COLLECTION_COMMAND = {
  name: "collection",
  description: "Your Riftbound collection",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "add",
      description: "Add copies of a card you own",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "card",
          description: "The card's name or collector code, or a legend's champion",
          required: true,
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "count",
          description: "How many copies (1 if left out)",
          min_value: 1,
          max_value: 99,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "lending",
      description: "Whether people in your servers may ask to borrow your cards",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "state",
          description: "On or off",
          required: true,
          choices: [
            { name: "On: I lend cards", value: "on" },
            { name: "Off: none of my cards are available", value: "off" },
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "default",
          description: "Which cards are available unless you mark them (asked the first time)",
          choices: Object.entries(LEND_DEFAULTS).map(([value, name]) => ({ name, value })),
        },
      ],
    },
  ],
} as const;

export interface CollectionWriter {
  /** Add copies of a printing as normal, near mint; the new count, or null for a forgotten user. */
  add(userId: string, printingId: string, count: number): Promise<number | null>;
  /** The stored default, or null before the member has picked one. */
  lendDefault(userId: string): Promise<LendDefault | null>;
  /** False when the database skipped the row (forgotten user). */
  setLending(userId: string, lends: boolean, lendDefault: LendDefault | null): Promise<boolean>;
}

const FORGOTTEN = "You asked to be forgotten, so nothing was saved. Use /show-me first.";
const FAILED = "Something went wrong, nothing was changed. Please try again later.";

/** /collection add: `typed` is the raw option, a picked suggestion's card id or a typed name or code. */
export async function addToCollection(
  writer: CollectionWriter,
  catalogue: Catalogue,
  userId: string,
  typed: string,
  count: number,
): Promise<string> {
  const found = lookupCard(catalogue, typed);
  if (!found || !("card" in found)) return cardMiss(typed, found?.ambiguous ?? null);
  // The first printing in collector order; another printing, finish or condition is set on the website.
  const printing = catalogue.printings
    .filter((p) => p.card_id === found.card.id)
    .sort((a, b) => a.collector_number - b.collector_number || a.collector_code.localeCompare(b.collector_code))[0];
  if (!printing) return `${found.card.name} has no printing to own yet.`;
  try {
    const total = await writer.add(userId, printing.id, count);
    if (total === null) return FORGOTTEN;
    return `Added ${count} × ${found.card.name} (${printing.collector_code}). You now have ${total}.`;
  } catch (err) {
    console.error("collection add failed:", err);
    return FAILED;
  }
}

/** /collection lending: turning it on the first time needs a default, so it asks for one instead. */
export async function setLending(writer: CollectionWriter, userId: string, state: string, picked: string | null): Promise<string> {
  const lends = state === "on";
  const chosen = picked && picked in LEND_DEFAULTS ? (picked as LendDefault) : null;
  try {
    const current = chosen ?? (await writer.lendDefault(userId));
    if (lends && !current) {
      return "Which of your cards are available to lend? Run /collection lending again with `default`: " +
        `"${LEND_DEFAULTS.nothing}" or "${LEND_DEFAULTS.everything}".`;
    }
    if (!(await writer.setLending(userId, lends, chosen))) return FORGOTTEN;
    if (!lends) return "Lending is off: none of your cards are available to borrow.";
    return `Lending is on. Available: ${LEND_DEFAULTS[current!].toLowerCase()}; a count you set on a card wins.`;
  } catch (err) {
    console.error("collection lending failed:", err);
    return FAILED;
  }
}
