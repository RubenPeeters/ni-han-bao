// /deck share (#175): one of a member's Riftbound decks posted in the channel, with a link to its
// page. Decks are built on the site; a private one is made visible first. In Discord's
// components since #225: card images, the list by type, Riot's icons as emojis.

import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMediaGalleryItem,
  type APITextDisplayComponent,
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js";
import { type Card, type Catalogue } from "./card-match.js";
import { DECK_SECTIONS, deckWarnings, type DeckEntry } from "./deck-match.js";
import { emoji, type Emojis } from "./emojis.js";
import { accentColor, cardImage, labelled, MAX_TEXT, type V2 } from "./riftbound-reply.js";
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

type Icons = { facet: string; label: string; color_primary: string | null }[];

const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });

/** A reply in Discord's components: once a message has them, every edit of it must too. */
export const textMessage = (content: string): V2 => ({ components: [text(content)], flags: MessageFlags.IsComponentsV2 });

/** A private deck: nobody else could open its link, so who may see it is asked first, by its Legend's picture. */
export function privatePrompt(name: string, legend: Card | null, catalogue: Pick<Catalogue, "printings">): V2 {
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, custom_id: SHARE_SERVERS_ID, label: "Servers: your servers' members", style: ButtonStyle.Primary },
      { type: ComponentType.Button, custom_id: SHARE_PUBLIC_ID, label: "Public: anyone logged in", style: ButtonStyle.Secondary },
      { type: ComponentType.Button, custom_id: SHARE_CANCEL_ID, label: "Cancel", style: ButtonStyle.Secondary },
    ],
  };
  const question = text(`**${escapeMarkdown(name)}** is private, so nobody else could open it. Who may see it?`);
  const image = legend && cardImage(catalogue, legend, 160);
  return {
    components: [
      image ? { type: ComponentType.Section, components: [question], accessory: { type: ComponentType.Thumbnail, media: { url: image }, description: legend.name } } : question,
      row,
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

const COPY_PREFIX = "deck-copy:";
/** The Copy as text button's id: the deck's, so any viewer's click finds it. */
export const copyButtonId = (deckId: string) => `${COPY_PREFIX}${deckId}`;
export const parseCopyButtonId = (id: string) => (id.startsWith(COPY_PREFIX) ? id.slice(COPY_PREFIX.length) : null);

/**
 * The site's can_see_deck() for the bot's privileged reads: the owner, anyone for a public deck,
 * and for a servers deck someone sharing a server with the owner now, given both their memberships.
 */
export function canSeeDeck(owner: string, visibility: string, viewer: string, memberships: { guild_id: string; user_id: string }[]): boolean {
  if (viewer === owner || visibility === "public") return true;
  if (visibility !== "servers") return false;
  const ownerGuilds = new Set(memberships.filter((m) => m.user_id === owner).map((m) => m.guild_id));
  return memberships.some((m) => m.user_id === viewer && ownerGuilds.has(m.guild_id));
}

// Media galleries take up to 10 images.
const GALLERY_MAX = 10;
// Riftbound's main deck types in the order a decklist reads, as on the deck page; any other type follows by name.
const TYPE_ORDER = ["Unit", "Spell", "Gear"];
const typeRank = (type: string) => (TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);

/**
 * The shared deck: the Legend's colour and domains, the Legend, Chosen Champion and battlefields
 * as pictures, the main deck by type then runes, battlefields and sideboard, "3× Card Name" by
 * energy, the sharer's missing count, the rules check, and buttons to open or copy the deck.
 */
export function deckMessage(
  deck: SharedDeck,
  entries: DeckEntry[],
  catalogue: Pick<Catalogue, "cards" | "printings">,
  icons: Icons,
  emojis: Emojis,
  sharer: string,
  missing: number,
  siteUrl: string | null,
): V2 {
  const cards = new Map(catalogue.cards.map((c) => [c.id, c]));
  const name = (id: string) => escapeMarkdown(cards.get(id)?.name ?? id);
  const legend = deck.legend_id ? cards.get(deck.legend_id) : undefined;
  const champion = deck.champion_id ? cards.get(deck.champion_id) : undefined;
  const page = siteUrl ? `${siteUrl.replace(/\/$/, "")}/decks/${deck.id}` : null;

  // Pinned printings of a card are one line: the reply counts cards, the page shows the pins.
  const counts = (section: string) => {
    const n = new Map<string, number>();
    for (const e of entries) if (e.section === section) n.set(e.card_id, (n.get(e.card_id) ?? 0) + e.quantity);
    return [...n];
  };
  const groups: { heading: string; cards: [string, number][] }[] = [];
  const typeOf = (id: string) => cards.get(id)?.type || "Other";
  const types = [...new Set(counts("main").map(([id]) => typeOf(id)))].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
  for (const type of types) groups.push({ heading: labelled(emojis, type), cards: counts("main").filter(([id]) => typeOf(id) === type) });
  for (const { value, label } of DECK_SECTIONS.slice(1)) {
    const icon = value === "runes" ? emoji(emojis, "rb_rune") : value === "battlefields" ? emoji(emojis, "rb_battlefield") : null;
    groups.push({ heading: icon ? `${icon} ${label}` : label, cards: counts(value) });
  }
  const energy = (id: string) => cards.get(id)?.energy ?? Infinity;
  const lines: { text: string; cards: number }[] = groups
    .filter((g) => g.cards.length)
    .flatMap((g) => [
      { text: `**${g.heading}** (${g.cards.reduce((n, [, q]) => n + q, 0)})`, cards: 0 },
      ...g.cards
        .sort(([a], [b]) => energy(a) - energy(b) || name(a).localeCompare(name(b)))
        .map(([id, n]) => {
          const card = cards.get(id);
          const domains = (card?.domains ?? []).map((d) => emoji(emojis, `rb_${d.toLowerCase()}`)).filter(Boolean).join("");
          const cost = card?.energy == null ? "" : ` · **${card.energy}**`;
          return { text: `${n}× ${name(id)}${domains ? ` ${domains}` : ""}${cost}`, cards: n };
        }),
    ]);

  const header = [
    `### ${escapeMarkdown(deck.name)}`,
    [`Shared by ${escapeMarkdown(sharer)}`, legend?.domains.map((d) => labelled(emojis, d)).join(" ")].filter(Boolean).join(" · "),
    `Legend: ${legend ? escapeMarkdown([...legend.tags.slice(0, 1), legend.name].join(", ")) : "none yet"} · Chosen Champion: ${champion ? name(champion.id) : "none yet"}`,
  ].join("\n");
  const warnings = deckWarnings(deck, entries, cards).length;
  const footer = [
    missing ? `${sharer} is missing ${missing} ${missing === 1 ? "card" : "cards"}` : `${sharer} owns every card`,
    warnings ? `${warnings} rules ${warnings === 1 ? "warning" : "warnings"}${page ? ": see the deck's page" : ""}` : "Rules check passed",
  ].join(" · ");

  const pictures = [legend, champion, ...counts("battlefields").map(([id]) => cards.get(id))]
    .filter((c): c is Card => !!c)
    .flatMap((c): APIMediaGalleryItem[] => {
      const url = cardImage(catalogue, c, 300);
      return url ? [{ media: { url }, description: c.name }] : [];
    })
    .slice(0, GALLERY_MAX);

  // Gallery descriptions and button labels count towards the limit too.
  const budget = MAX_TEXT - header.length - footer.length - pictures.reduce((n, p) => n + (p.description?.length ?? 0), 0) - 50;
  const more = (n: number) => `and ${n} more ${n === 1 ? "card" : "cards"}${page ? `: ${page}` : ""}`;
  let kept = lines.length;
  const list = () => {
    const left = lines.slice(kept).reduce((n, l) => n + l.cards, 0);
    // A heading with none of its cards shown goes too.
    const shown = lines.slice(0, kept);
    while (shown.length && shown[shown.length - 1].cards === 0) shown.pop();
    return [...shown.map((l) => l.text), ...(left ? [more(left)] : [])].join("\n");
  };
  while (kept > 0 && list().length > budget) kept--;

  const separator = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small } as const;
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: legend ? accentColor(legend, icons) : undefined,
    components: [
      text(header),
      ...(pictures.length ? [{ type: ComponentType.MediaGallery as const, items: pictures }] : []),
      ...(lines.length ? [separator, text(list())] : []),
      separator,
      text(`-# ${escapeMarkdown(footer)}`),
    ],
  };
  const buttons: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      ...(page ? [{ type: ComponentType.Button as const, style: ButtonStyle.Link as const, label: "Open deck", url: page }] : []),
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Copy as text", custom_id: copyButtonId(deck.id) },
    ],
  };
  return { components: [container, buttons], flags: MessageFlags.IsComponentsV2 };
}
