// The layout every Riftbound reply shares (#224), in Discord's components (MessageFlags.IsComponentsV2):
// Riot's icons as the bot's emojis, the domain's colour, and Discord's limits kept.
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMediaGalleryComponent,
  type APIMessageTopLevelComponent,
  type APISectionComponent,
  type APISeparatorComponent,
  type APITextDisplayComponent,
} from "discord.js";
import { byPrinting, cardImageUrl, plainText, textParts, type Card, type CardToken, type Printing } from "./card-match.js";
import { emoji, type Emojis } from "./emojis.js";

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

const separator: APISeparatorComponent = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };
const gallery = (url: string, description: string): APIMediaGalleryComponent => ({
  type: ComponentType.MediaGallery,
  items: [{ media: { url }, description }],
});

/** /card: the card's image, heading, rules text and printings, and a button to its page on the site. */
export function cardMessage(
  card: Card,
  printings: Printing[],
  icons: { facet: string; label: string; color_primary: string | null }[],
  emojis: Emojis,
  siteUrl: string | null,
): { components: APIMessageTopLevelComponent[]; flags: MessageFlags.IsComponentsV2 } {
  const sorted = [...printings].sort(byPrinting);
  const image = sorted.find((p) => p.image_url)?.image_url;
  const page = siteUrl ? `${siteUrl.replace(/\/$/, "")}/cards/${card.id}` : null;
  const heading = cardHeading(card, emojis);
  const rules = card.rules_text ? discordRules(card.rules_text, emojis) : "";
  const lines = sorted.map((p) => {
    const rarity = p.rarity ? emoji(emojis, `rb_${p.rarity.toLowerCase()}`) : null;
    return [rarity, `**${p.collector_code.replace(/[*_~`|\\]/g, "\\$&")}**`, p.rarity && `· ${p.rarity}`].filter(Boolean).join(" ");
  });
  // The image description and the button label count too.
  const budget = MAX_TEXT - heading.length - rules.length - card.name.length - 50;
  const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });
  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: accentColor(card, icons),
    components: [
      ...(image ? [gallery(cardImageUrl(image, 600), card.name)] : []),
      text(heading),
      ...(rules ? [separator, text(rules)] : []),
      ...(lines.length ? [separator, text(fitLines(lines, budget, page))] : []),
    ],
  };
  const button: APIActionRowComponent<APIButtonComponent>[] = page
    ? [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Card page", url: page }] }]
    : [];
  return { components: [container, ...button], flags: MessageFlags.IsComponentsV2 };
}
