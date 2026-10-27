// /collection (#150): quick entry at a table, and the "I lend cards" opt-in. The website's
// Cards grid is the full editor; this adds normal, NM copies of a card's first printing, in
// the language asked for or else the one last added in.

import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { type Emojis } from "./emojis.js";
import { cardMiss, lookupCard, type Card, type Catalogue, type Printing } from "./riftbound.js";
import { imageOf, labelled, withThumbnail, type V2 } from "./riftbound-reply.js";
import { escapeMarkdown } from "./stores.js";

/** The database's riftbound_language domain, as the site's lib/collection.ts has it. */
export const LANGUAGES = [
  { name: "English", value: "en" },
  { name: "Chinese (Simplified)", value: "zh-Hans" },
  { name: "French", value: "fr" },
];
export const languageName = (code: string) => LANGUAGES.find((l) => l.value === code)?.name ?? code;

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
        {
          type: ApplicationCommandOptionType.String,
          name: "language",
          description: "The copies' language (the one you last added in if left out)",
          choices: LANGUAGES,
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
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "share",
      description: "Post a summary of your collection in this channel",
    },
  ],
} as const;

export interface CollectionWriter {
  /**
   * Add normal, NM copies, in the member's last-used language when `language` is null; the
   * new count and the language, or null when the database skipped a forgotten user.
   */
  add(userId: string, printingId: string, count: number, language: string | null): Promise<{ total: number; language: string } | null>;
  /** lendAll null keeps the current default. Null when the database skipped a forgotten user. */
  setLending(userId: string, lends: boolean, lendAll: boolean | null): Promise<{ lendAll: boolean; visibility: string } | null>;
}

const FORGOTTEN = "You asked to be forgotten, so nothing was saved. Use /show-me first.";
const FAILED = "Something went wrong, nothing was changed. Please try again later.";

/** What /collection add added: the printing's picture and rarity, and the new count. */
export function addedMessage(catalogue: Pick<Catalogue, "printings">, card: Card, printing: Printing, n: number, total: number, language: string, emojis: Emojis): V2 {
  const added = `Added ${n}× **${escapeMarkdown(card.name)}** in ${languageName(language)} · you now have ${total}`;
  const printed = [printing.rarity && labelled(emojis, printing.rarity), printing.collector_code].filter(Boolean).join(" · ");
  return { components: [withThumbnail(`${added}\n-# ${printed}`, imageOf(catalogue, card, 160, printing.id), card.name)], flags: MessageFlags.IsComponentsV2 };
}

/** /collection add: the (ephemeral) reply; `typed` is the card option, a picked id or a typed name. */
export async function addToCollection(
  writer: CollectionWriter,
  catalogue: Catalogue,
  emojis: Emojis,
  userId: string,
  typed: string,
  count: number,
  language: string | null,
): Promise<string | V2> {
  const found = lookupCard(catalogue, typed);
  if (!found || !("card" in found)) return cardMiss(typed, found?.ambiguous ?? null);
  const printing = catalogue.printings
    .filter((p) => p.card_id === found.card.id)
    .sort((a, b) => a.collector_number - b.collector_number || a.collector_code.localeCompare(b.collector_code))[0];
  if (!printing) return `${found.card.name} has no printing to add yet.`;
  // Discord enforces the bounds, but the option is still caller input.
  const n = Math.min(99, Math.max(1, Math.trunc(count)));
  try {
    const added = await writer.add(userId, printing.id, n, language);
    if (added === null) return FORGOTTEN;
    return addedMessage(catalogue, found.card, printing, n, added.total, added.language, emojis);
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
      siteUrl && `${siteUrl}/collection`,
    ];
    return reply.filter(Boolean).join(" ");
  } catch (err) {
    console.error("collection lending failed:", err);
    return FAILED;
  }
}
