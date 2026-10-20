// /deck share (#175): one of a member's Riftbound decks posted in the channel, with a link to its
// page. Decks are built on the site; a private one is made visible first.

import { type APIActionRowComponent, type APIButtonComponent, type APIEmbed, ApplicationCommandOptionType, ButtonStyle, ComponentType } from "discord.js";
import type { Catalogue } from "./card-match.js";
import type { DeckEntry } from "./deck-match.js";
import { escapeMarkdown } from "./stores.js";

export const DECK_COMMAND = {
  name: "deck",
  description: "Your Riftbound decks",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "share",
      description: "Post one of your decks in this channel",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "deck",
          description: "One of your decks",
          required: true,
          autocomplete: true,
        },
      ],
    },
  ],
} as const;

export interface SharedDeck {
  id: string;
  name: string;
  legend_id: string | null;
  champion_id: string | null;
  visibility: string;
  language: string;
  allow_other_languages: boolean;
}

export const SHARE_SERVERS_ID = "deck-share:servers";
export const SHARE_PUBLIC_ID = "deck-share:public";
export const SHARE_CANCEL_ID = "deck-share:cancel";

/** A private deck: nobody else could open its link, so who may see it is asked first. */
export function privatePrompt(name: string) {
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, custom_id: SHARE_SERVERS_ID, label: "Servers: your servers' members", style: ButtonStyle.Primary },
      { type: ComponentType.Button, custom_id: SHARE_PUBLIC_ID, label: "Public: anyone logged in", style: ButtonStyle.Secondary },
      { type: ComponentType.Button, custom_id: SHARE_CANCEL_ID, label: "Cancel", style: ButtonStyle.Secondary },
    ],
  };
  return { content: `**${escapeMarkdown(name)}** is private, so nobody else could open it. Who may see it?`, components: [row] };
}

const SECTIONS = [
  ["main", "Main deck"],
  ["runes", "Runes"],
  ["battlefields", "Battlefields"],
  ["sideboard", "Sideboard"],
] as const;
// Discord's limit for a field's value.
const FIELD_MAX = 1024;

/** The shared deck: Legend, Chosen Champion, "3 Card Name" per section, the sharer's missing count and the deck's link. */
export function deckEmbed(deck: SharedDeck, entries: DeckEntry[], catalogue: Pick<Catalogue, "cards">, sharer: string, missing: number, siteUrl: string | null): APIEmbed {
  const cards = new Map(catalogue.cards.map((c) => [c.id, c]));
  const name = (id: string) => escapeMarkdown(cards.get(id)?.name ?? id);
  const legend = deck.legend_id ? cards.get(deck.legend_id) : undefined;
  const fields = SECTIONS.flatMap(([section, label]) => {
    // Pinned printings of a card are one line: the embed counts cards, the page shows the pins.
    const counts = new Map<string, number>();
    for (const e of entries) if (e.section === section) counts.set(e.card_id, (counts.get(e.card_id) ?? 0) + e.quantity);
    if (!counts.size) return [];
    const lines = [...counts].sort(([a], [b]) => name(a).localeCompare(name(b))).map(([id, n]) => `${n} ${name(id)}`);
    let shown = lines.length;
    const value = () => lines.slice(0, shown).join("\n") + (shown < lines.length ? `\n…and ${lines.length - shown} more` : "");
    while (value().length > FIELD_MAX) shown--;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return [{ name: `${label} (${total})`, value: value() }];
  });
  const placeholder = [legend, ...entries.map((e) => cards.get(e.card_id))].some((c) => c?.placeholder);
  return {
    title: deck.name.slice(0, 256),
    url: siteUrl ? `${siteUrl.replace(/\/$/, "")}/decks/${deck.id}` : undefined,
    description: [
      `Legend: ${legend ? escapeMarkdown(`${legend.tags.join(", ")}, ${legend.name}`) : "none yet"}`,
      `Chosen Champion: ${deck.champion_id ? name(deck.champion_id) : "none yet"}`,
    ].join("\n"),
    fields,
    footer: {
      text: [missing ? `${sharer} is missing ${missing} ${missing === 1 ? "card" : "cards"}` : `${sharer} owns every card`, placeholder && "Placeholder cards"]
        .filter(Boolean)
        .join(" · "),
    },
  };
}
