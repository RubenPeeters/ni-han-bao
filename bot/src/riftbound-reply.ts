// The layout every Riftbound reply shares (#224), in Discord's components (MessageFlags.IsComponentsV2):
// Riot's icons as the bot's emojis, the domain's colour, and Discord's limits kept.
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMediaGalleryComponent,
  type APIMessageTopLevelComponent,
  type APISectionComponent,
  type APITextDisplayComponent,
} from "discord.js";
import { byPrinting, cardImageUrl, plainText, textParts, type Card, type CardToken, type Catalogue, type Printing } from "./card-match.js";
import { emoji, type Emojis } from "./emojis.js";

/** A message in Discord's components. */
export type V2 = { components: APIMessageTopLevelComponent[]; flags: MessageFlags.IsComponentsV2 };

// Per message: every component counts, nested ones too, and all of their text together.
export const MAX_COMPONENTS = 40;
export const MAX_TEXT = 4000;

/** "Fury" with its emoji in front, or the word alone without one. */
export const labelled = (emojis: Emojis, label: string) => {
  const e = emoji(emojis, `rb_${label.toLowerCase()}`);
  return e ? `${e} ${label}` : label;
};

function tokenText(token: CardToken, emojis: Emojis): string {
  // Riot has no energy icon.
  if (token.kind === "energy") return `**${token.value}**`;
  if (token.kind === "might") return emoji(emojis, "rb_might") ?? "might";
  if (token.kind === "rune") return emoji(emojis, `rb_${token.value}`) ?? (token.value === "rainbow" ? "any rune" : `${token.value} rune`);
  return token.value.replace(/_/g, " ");
}

/** Riot's card text for Discord: its icon tokens as the bot's emojis, or as words where there is none. */
export function discordRules(html: string, emojis: Emojis): string {
  const parts = textParts(plainText(html));
  // An empty part between two tokens: a space, so "any rune any rune" stays readable.
  return parts.map((p, i) => (typeof p !== "string" ? tokenText(p, emojis) : p || (i > 0 && i < parts.length - 1 ? " " : ""))).join("");
}

/** The card's name, then its type, domains, energy and might, with their emojis. */
export function cardHeading(card: Card, emojis: Emojis): string {
  const line = [
    [...card.supertypes, card.type || "Card"].map((t) => labelled(emojis, t)).join(" "),
    card.domains.map((d) => labelled(emojis, d)).join(" "),
    card.energy === null ? "" : `**${card.energy}** energy`,
    card.might === null ? "" : `**${card.might}** ${emoji(emojis, "rb_might") ?? "might"}`,
  ];
  return `### ${card.name}\n${line.filter(Boolean).join(" · ")}`;
}

/** A card in a list: its heading, and a thumbnail of the printing's image when it has one. */
export function cardSection(card: Card, printing: Printing | null, emojis: Emojis): APISectionComponent | APITextDisplayComponent {
  const text: APITextDisplayComponent = { type: ComponentType.TextDisplay, content: cardHeading(card, emojis) };
  if (!printing?.image_url) return text;
  // Battlefields are printed landscape: wider, for the same height.
  const width = card.type === "Battlefield" ? 224 : 160;
  return {
    type: ComponentType.Section,
    components: [text],
    accessory: { type: ComponentType.Thumbnail, media: { url: cardImageUrl(printing.image_url, width) }, description: card.name },
  };
}

/** The card's image at `width` pixels: the given printing's, else its first printing's with one. */
export function imageOf(catalogue: Pick<Catalogue, "printings">, card: Card, width: number, printingId: string | null = null): string | null {
  const url = catalogue.printings
    .filter((p) => p.card_id === card.id && p.image_url)
    .sort((a, b) => Number(b.id === printingId) - Number(a.id === printingId) || byPrinting(a, b))[0]?.image_url;
  return url ? cardImageUrl(url, card.type === "Battlefield" ? Math.round(width * 1.4) : width) : null;
}

/** Text with a picture beside it, or the text alone without one. */
export function withThumbnail(content: string, image: string | null, description: string): APISectionComponent | APITextDisplayComponent {
  const text: APITextDisplayComponent = { type: ComponentType.TextDisplay, content };
  return image
    ? { type: ComponentType.Section, components: [text], accessory: { type: ComponentType.Thumbnail, media: { url: image }, description } }
    : text;
}

/** The card's colour: its (first) domain's, from Riot's feed. */
export function accentColor(card: Card, icons: { facet: string; label: string; color_primary: string | null }[]): number | undefined {
  const color = icons.find((i) => i.facet === "domain" && i.label === card.domains[0])?.color_primary;
  return color ? parseInt(color.slice(1), 16) : undefined;
}

/** Lines within `budget` characters; past that, the last line says how many more, with the link. */
export function fitLines(lines: string[], budget: number, moreUrl: string | null): string {
  const more = (n: number) => `and ${n} more${moreUrl ? `: ${moreUrl}` : ""}`;
  for (let kept = lines.length; kept >= 0; kept--) {
    const text = [...lines.slice(0, kept), ...(kept < lines.length ? [more(lines.length - kept)] : [])].join("\n");
    if (text.length <= budget) return text;
  }
  return more(lines.length).slice(0, budget);
}

const gallery = (url: string, description: string): APIMediaGalleryComponent => ({
  type: ComponentType.MediaGallery,
  items: [{ media: { url }, description }],
});

/** How long /card's Previous and Next answer, counted from the reply. */
export const PAGING_MS = 15 * 60_000;
/** A paging button's id: the card and the page it opens, so a click works after a restart. */
export const pageButtonId = (cardId: string, index: number) => `card-page:${cardId}:${index}`;
export function parsePageButtonId(customId: string): { cardId: string; index: number } | null {
  const m = /^card-page:(.+):(\d+)$/.exec(customId);
  return m ? { cardId: m[1], index: Number(m[2]) } : null;
}

const escaped = (code: string) => code.replace(/[*_~`|\\]/g, "\\$&");

/** /card: one page per printing, its image and every version below it, the shown one in bold. */
export function cardMessage(
  card: Card,
  printings: Printing[],
  icons: { facet: string; label: string; color_primary: string | null }[],
  emojis: Emojis,
  siteUrl: string | null,
  index = 0,
): V2 {
  const sorted = [...printings].sort(byPrinting);
  const shown = sorted[index] ?? null;
  const page = siteUrl ? `${siteUrl.replace(/\/$/, "")}/cards/${card.id}` : null;
  const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });
  const rarity = shown?.rarity ? emoji(emojis, `rb_${shown.rarity.toLowerCase()}`) : null;
  const body = shown?.image_url
    ? gallery(cardImageUrl(shown.image_url, 600), card.name)
    : text([rarity, `**${escaped(shown?.collector_code ?? card.name)}**`, shown?.rarity && `· ${shown.rarity}`].filter(Boolean).join(" "));
  // shortcut: a card with hundreds of printings would pass Discord's text limit; real cards have a handful.
  const footnote = sorted.map((p, i) => (i === index ? `**${escaped(p.collector_code)}**` : escaped(p.collector_code))).join(" · ");
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: accentColor(card, icons),
    components: [body, ...(footnote ? [text(`-# ${footnote}`)] : [])],
  };
  const paging = (label: string, to: number): APIButtonComponent => ({
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    label,
    custom_id: pageButtonId(card.id, Math.max(to, 0)),
    disabled: to < 0 || to >= sorted.length,
  });
  const buttons: APIButtonComponent[] = [
    ...(sorted.length > 1 ? [paging("Previous", index - 1), paging("Next", index + 1)] : []),
    ...(page ? [{ type: ComponentType.Button as const, style: ButtonStyle.Link as const, label: "Card page", url: page }] : []),
  ];
  const row: APIActionRowComponent<APIButtonComponent>[] = buttons.length ? [{ type: ComponentType.ActionRow, components: buttons }] : [];
  return { components: [container, ...row], flags: MessageFlags.IsComponentsV2 };
}
