// /deck share (#175): one of a member's Riftbound decks posted in the channel, with a link to its
// page. Decks are built on the site; a private one is made visible first. In Discord's
// components since #225: card images, Riot's icons as emojis; a teaser with the energy curve since #251.

import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMediaGalleryItem,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js";
import { type Card, type Catalogue } from "./card-match.js";
import { energyCurve, type DeckEntry } from "./deck-match.js";
import { type Emojis } from "./emojis.js";
import { accentColor, imageOf, labelled } from "./riftbound-reply.js";
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
  /** The Legend's pinned printing; null for any. */
  legend_printing_id: string | null;
  champion_id: string | null;
  visibility: string;
  language: string;
  allow_other_languages: boolean;
}

export const SHARE_SERVERS_ID = "deck-share:servers";
export const SHARE_PUBLIC_ID = "deck-share:public";
export const SHARE_CANCEL_ID = "deck-share:cancel";

type Icons = { facet: string; label: string; color_primary: string | null }[];
type V2 = { components: APIMessageTopLevelComponent[]; flags: MessageFlags.IsComponentsV2 };

const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });

/** A reply in Discord's components: once a message has them, every edit of it must too. */
export const textMessage = (content: string): V2 => ({ components: [text(content)], flags: MessageFlags.IsComponentsV2 });

/** A private deck: nobody else could open its link, so who may see it is asked first, by its Legend's picture (its pinned printing's, if any). */
export function privatePrompt(name: string, legend: Card | null, catalogue: Pick<Catalogue, "printings">, printingId: string | null = null): V2 {
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, custom_id: SHARE_SERVERS_ID, label: "Servers: your servers' members", style: ButtonStyle.Primary },
      { type: ComponentType.Button, custom_id: SHARE_PUBLIC_ID, label: "Public: anyone logged in", style: ButtonStyle.Secondary },
      { type: ComponentType.Button, custom_id: SHARE_CANCEL_ID, label: "Cancel", style: ButtonStyle.Secondary },
    ],
  };
  const question = text(`**${escapeMarkdown(name)}** is private, so nobody else could open it. Who may see it?`);
  const image = legend && imageOf(catalogue, legend, 160, printingId);
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

// The longest bar's blocks: the code block still fits a phone's width.
const BAR_WIDTH = 16;

/** The energy curve as text bars, one row per bucket, the longest bar BAR_WIDTH blocks; an empty bucket is a sliver. */
export function curveBars(curve: { energy: string; count: number }[]): string {
  const top = Math.max(0, ...curve.map((b) => b.count));
  const label = Math.max(0, ...curve.map((b) => b.energy.length)) + 1;
  return curve
    .map((b) => `${b.energy.padEnd(label)}${b.count ? "█".repeat(Math.max(1, Math.round((b.count / top) * BAR_WIDTH))) : "▏"} ${b.count}`)
    .join("\n");
}

/**
 * The shared deck as a teaser, the full list being on its page: the Legend's colour and domains,
 * the Legend and Chosen Champion as pictures, the main deck's energy curve and card count, and
 * buttons to open or copy the deck.
 */
export function deckMessage(
  deck: SharedDeck,
  entries: DeckEntry[],
  catalogue: Pick<Catalogue, "cards" | "printings">,
  icons: Icons,
  emojis: Emojis,
  sharer: string,
  siteUrl: string | null,
): V2 {
  const cards = new Map(catalogue.cards.map((c) => [c.id, c]));
  const legend = deck.legend_id ? cards.get(deck.legend_id) : undefined;
  const champion = deck.champion_id ? cards.get(deck.champion_id) : undefined;
  const page = siteUrl ? `${siteUrl.replace(/\/$/, "")}/decks/${deck.id}` : null;
  const legendCode = catalogue.printings.find((p) => p.id === deck.legend_printing_id)?.collector_code;

  const header = [
    `### ${escapeMarkdown(deck.name)}`,
    [`Shared by ${escapeMarkdown(sharer)}`, legend?.domains.map((d) => labelled(emojis, d)).join(" ")].filter(Boolean).join(" · "),
    `Legend: ${legend ? escapeMarkdown([...legend.tags.slice(0, 1), legend.name].join(", ")) + (legendCode ? ` (${escapeMarkdown(legendCode)})` : "") : "none yet"} · Chosen Champion: ${champion ? escapeMarkdown(champion.name) : "none yet"}`,
  ].join("\n");
  const main = entries.filter((e) => e.section === "main").reduce((n, e) => n + e.quantity, 0);
  const curve = energyCurve(entries, cards);

  const pictures = [legend, champion]
    .filter((c): c is Card => !!c)
    .flatMap((c): APIMediaGalleryItem[] => {
      const url = imageOf(catalogue, c, 300, c === legend ? deck.legend_printing_id : null);
      return url ? [{ media: { url }, description: c.name }] : [];
    });

  const separator = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small } as const;
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: legend ? accentColor(legend, icons) : undefined,
    components: [
      text(header),
      ...(pictures.length ? [{ type: ComponentType.MediaGallery as const, items: pictures }] : []),
      ...(curve.some((b) => b.count) ? [separator, text(`**Energy curve**\n\`\`\`\n${curveBars(curve)}\n\`\`\``)] : []),
      separator,
      text(`-# ${main} ${main === 1 ? "card" : "cards"} in the main deck`),
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
