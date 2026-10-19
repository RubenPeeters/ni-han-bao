// /collection (#150): quick entry at a table, and the "I lend cards" opt-in. The website's
// Cards grid is the full editor; this adds normal, NM copies of a card's first printing.

import { ApplicationCommandOptionType } from "discord.js";
import { cardMiss, lookupCard, type Catalogue } from "./riftbound.js";

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
          description: "How many (1 if left out)",
          min_value: 1,
          max_value: 99,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "lending",
      description: "Whether members of your servers may ask to borrow your cards",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "state",
          description: "On or off",
          required: true,
          choices: [
            { name: "On: I lend cards", value: "on" },
            { name: "Off: none of my cards are lendable", value: "off" },
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "default",
          description: "What you lend when a card has no count of its own",
          choices: [
            { name: "Nothing until I mark cards", value: "nothing" },
            { name: "Everything I own", value: "everything" },
          ],
        },
      ],
    },
  ],
} as const;

export interface CollectionWriter {
  /** Add normal, NM copies; the new count, or null when the database skipped a forgotten user. */
  add(userId: string, printingId: string, count: number): Promise<number | null>;
  /** lendAll null keeps the current default. Null when the database skipped a forgotten user. */
  setLending(userId: string, lends: boolean, lendAll: boolean | null): Promise<{ lendAll: boolean; visibility: string } | null>;
}

const FORGOTTEN = "You asked to be forgotten, so nothing was saved. Use /show-me first.";
const FAILED = "Something went wrong, nothing was changed. Please try again later.";

/** /collection add: the (ephemeral) reply; `typed` is the card option, a picked id or a typed name. */
export async function addToCollection(
  writer: CollectionWriter,
  catalogue: Catalogue,
  userId: string,
  typed: string,
  count: number,
): Promise<string> {
  const found = lookupCard(catalogue, typed);
  if (!found || !("card" in found)) return cardMiss(typed, found?.ambiguous ?? null);
  const printing = catalogue.printings
    .filter((p) => p.card_id === found.card.id)
    .sort((a, b) => a.collector_number - b.collector_number || a.collector_code.localeCompare(b.collector_code))[0];
  if (!printing) return `${found.card.name} has no printing to add yet.`;
  // Discord enforces the bounds, but the option is still caller input.
  const n = Math.min(99, Math.max(1, Math.trunc(count)));
  try {
    const total = await writer.add(userId, printing.id, n);
    if (total === null) return FORGOTTEN;
    return `Added ${n} × ${found.card.name} (${printing.collector_code}). You now have ${total} normal NM.`;
  } catch (err) {
    console.error("collection add failed:", err);
    return FAILED;
  }
}

/** /collection lending: on or off, and on optionally with the default. */
export async function setLending(
  writer: CollectionWriter,
  userId: string,
  state: string,
  fallback: string | null,
  siteUrl: string | null,
): Promise<string> {
  const lends = state === "on";
  const lendAll = fallback === "everything" ? true : fallback === "nothing" ? false : null;
  try {
    const saved = await writer.setLending(userId, lends, lends ? lendAll : null);
    if (!saved) return FORGOTTEN;
    if (!lends) return "Lending is off: none of your cards show as lendable any more.";
    const reply = [
      saved.lendAll
        ? "Lending is on: everything you own is lendable, except cards you set a lower count for."
        : "Lending is on: nothing is lendable until you mark cards with To lend on the Cards page.",
      lendAll === null && `Change that with \`default\` (${saved.lendAll ? "nothing" : "everything"}).`,
      saved.visibility === "private" && "Your profile is private, so nobody sees you yet: /profile visibility.",
      siteUrl && `${siteUrl}/u/${userId}/collection`,
    ];
    return reply.filter(Boolean).join(" ");
  } catch (err) {
    console.error("collection lending failed:", err);
    return FAILED;
  }
}
