// /deck share (#175): a member's Riftbound deck posted in the channel, with a link to its page
// and a button that tells whoever clicks it what they are missing. Decks are built on the site.

import { type APIActionRowComponent, type APIButtonComponent, type APIEmbed, ApplicationCommandOptionType, ButtonStyle, ComponentType } from "discord.js";
import { normal, type Catalogue } from "./card-match.js";
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
          description: "Start typing its name",
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

/** Autocomplete over the caller's own decks, in the order given (most recently changed first); the value is the deck id. */
export function deckChoices(decks: Pick<SharedDeck, "id" | "name">[], typed: string): { name: string; value: string }[] {
  const q = normal(typed);
  return decks
    .filter((d) => normal(d.name).includes(q))
    .slice(0, 25)
    .map((d) => ({ name: d.name.slice(0, 100), value: d.id }));
}

/** The deck option: a picked suggestion is an id, anything else the exact name of one deck of theirs. */
export function pickDeck<D extends Pick<SharedDeck, "id" | "name">>(decks: D[], value: string): D | null {
  const named = decks.filter((d) => normal(d.name) === normal(value));
  return decks.find((d) => d.id === value) ?? (named.length === 1 ? named[0] : null);
}

export const SHARE_SERVERS_ID = "deck-share:servers";
export const SHARE_PUBLIC_ID = "deck-share:public";
export const SHARE_CANCEL_ID = "deck-share:cancel";

/** A private deck is made visible first: nobody else could open its link. */
export function privatePrompt(name: string) {
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, custom_id: SHARE_SERVERS_ID, label: "Servers: your servers' members", style: ButtonStyle.Primary },
      { type: ComponentType.Button, custom_id: SHARE_PUBLIC_ID, label: "Public: anyone with the link", style: ButtonStyle.Secondary },
      { type: ComponentType.Button, custom_id: SHARE_CANCEL_ID, label: "Cancel", style: ButtonStyle.Secondary },
    ],
  };
  return {
    content: `**${escapeMarkdown(name)}** is private, so nobody else could open it. Who may see it, to share it?`,
    components: [row],
  };
}

const MISSING_PREFIX = "deck-missing:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The What am I missing? button's deck id, or null for another button. Comes back from Discord, so checked. */
export function missingDeckId(customId: string): string | null {
  if (!customId.startsWith(MISSING_PREFIX)) return null;
  const id = customId.slice(MISSING_PREFIX.length);
  return UUID.test(id) ? id : null;
}

const SECTIONS = [
  ["main", "Main deck"],
  ["runes", "Runes"],
  ["battlefields", "Battlefields"],
  ["sideboard", "Sideboard"],
] as const;
const deckUrl = (siteUrl: string | null, id: string) => (siteUrl ? `${siteUrl.replace(/\/$/, "")}/decks/${id}` : undefined);

/** The shared deck: legend, champion and "3 Card Name" per section, the sharer's missing count, and the button. */
export function deckMessage(deck: SharedDeck, entries: DeckEntry[], catalogue: Catalogue, sharer: string, missing: number, siteUrl: string | null) {
  const cards = new Map(catalogue.cards.map((c) => [c.id, c]));
  const name = (id: string) => escapeMarkdown(cards.get(id)?.name ?? id);
  const legend = deck.legend_id ? cards.get(deck.legend_id) : undefined;
  const fields = SECTIONS.flatMap(([section, label]) => {
    const counts = new Map<string, number>();
    for (const e of entries) if (e.section === section) counts.set(e.card_id, (counts.get(e.card_id) ?? 0) + e.quantity);
    if (!counts.size) return [];
    const lines = [...counts]
      .map(([id, n]) => ({ n, card: name(id) }))
      .sort((x, y) => x.card.localeCompare(y.card))
      .map((l) => `${l.n} ${l.card}`);
    // Discord takes 1024 characters per field; the deck page lists them all.
    let value = lines.join("\n");
    for (let shown = lines.length - 1; value.length > 1024; shown--) value = `${lines.slice(0, shown).join("\n")}\n…and ${lines.length - shown} more`;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return [{ name: `${label} (${total})`, value, inline: false }];
  });
  const placeholder = [legend, ...entries.map((e) => cards.get(e.card_id))].some((c) => c?.placeholder);
  const embed: APIEmbed = {
    title: deck.name,
    url: deckUrl(siteUrl, deck.id),
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
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.Button, custom_id: `${MISSING_PREFIX}${deck.id}`, label: "What am I missing?", style: ButtonStyle.Secondary }],
  };
  return { embeds: [embed], components: [row] };
}

/** The What am I missing? reply, only the clicker sees it. */
export function missingText(deck: Pick<SharedDeck, "id" | "name">, missing: number, siteUrl: string | null): string {
  const url = deckUrl(siteUrl, deck.id);
  const name = `**${escapeMarkdown(deck.name)}**`;
  return [
    missing ? `You are missing ${missing} ${missing === 1 ? "card" : "cards"} for ${name}.` : `You own every card in ${name}.`,
    url && `Which ones: ${url}`,
  ]
    .filter(Boolean)
    .join(" ");
}
