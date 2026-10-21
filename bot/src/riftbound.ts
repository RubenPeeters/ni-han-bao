// The Riftbound card catalogue (#148), Riot's real cards since #206, and the replies about
// cards. Rows have the columns of riftbound_cards and riftbound_printings.

import { ApplicationCommandOptionType } from "discord.js";
import { codeRanks, normal, resolveCard, type Card, type Catalogue, type Printing, type Resolved } from "./card-match.js";

export { resolveCard, type Card, type Catalogue, type Printing, type Resolved };

/** One card per line, so a regenerated catalogue diffs by card. */
export function catalogueJson({ cards, printings, icons }: { cards: object[]; printings: object[]; icons: object[] }): string {
  const list = (rows: object[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return `{\n  "cards": [\n${list(cards)}\n  ],\n  "printings": [\n${list(printings)}\n  ],\n  "icons": [\n${list(icons)}\n  ]\n}\n`;
}

export const CARD_COMMAND = {
  name: "card",
  description: "Look up a Riftbound card",
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "name",
      description: "The card's name or collector code, or a legend's champion",
      required: true,
      autocomplete: true,
    },
  ],
} as const;

// Legends are named by epithet, so the champion goes in the label: typing "ahri" finds hers.
// Riot's tokens have no type (#203): "Card" rather than "null".
export const choiceLabel = (c: Card) => `${c.name} (${c.type === "Legend" ? `${c.tags.join(", ")} legend` : c.type || "Card"})`;

/**
 * Autocomplete: up to Discord's 25, cards a typed number finds (in set order) and then names
 * starting with what was typed first. The value is the card id.
 */
export function cardChoices({ cards, printings }: Catalogue, typed: string): { name: string; value: string }[] {
  const q = normal(typed);
  const coded = codeRanks(printings, typed);
  const starts = (c: Card) =>
    coded.has(c.id) ? 0 : normal(c.name).startsWith(q) || c.tags.some((t) => normal(t).startsWith(q)) ? 1 : 2;
  return cards
    .filter((c) => coded.has(c.id) || normal(choiceLabel(c)).includes(q))
    .sort((a, b) => starts(a) - starts(b) || (coded.get(a.id) ?? 0) - (coded.get(b.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((c) => ({ name: choiceLabel(c).slice(0, 100), value: c.id }));
}

/** The /card option: a picked suggestion is a card id, anything else is a typed name or code. */
export function lookupCard(catalogue: Catalogue, value: string): Resolved {
  const picked = catalogue.cards.find((c) => c.id === value);
  return picked ? { card: picked } : resolveCard(catalogue, value);
}

/** The reply to a name or code that is not exactly one card. */
export function cardMiss(typed: string, ambiguous: Card[] | null): string {
  if (!ambiguous) return `No card called or numbered "${typed.slice(0, 100)}". Pick one from the suggestions.`;
  return `More than one card matches that: ${ambiguous.slice(0, 10).map(choiceLabel).join(", ")}. Pick one from the suggestions.`;
}
