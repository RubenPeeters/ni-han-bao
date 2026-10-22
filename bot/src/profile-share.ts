// /collection share and /wishlist share (#250): a summary of a member's collection or wishlist
// posted in the channel, a DM too, with a link to their profile's page. Who may open that page
// follows their profile's visibility, so a private profile posts nothing.

import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js";
import { byPrinting, SET_NAMES, type Catalogue } from "./card-match.js";
import { emoji, type Emojis } from "./emojis.js";
import { imageOf, type V2, withThumbnail } from "./riftbound-reply.js";
import { escapeMarkdown } from "./stores.js";
import { type Wanted } from "./wishlist.js";

export const WISHLIST_COMMAND = {
  name: "wishlist",
  description: "Your Riftbound wishlist",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "share",
      description: "Post the cards you still want in this channel",
    },
  ],
} as const;

/** Who is sharing: their id for the link, their name for the heading, and their profile's visibility (null: no profile yet, so private). */
export interface Sharer {
  id: string;
  name: string;
  visibility: string | null;
}

const RARITY_ORDER = ["Showcase", "Epic", "Rare", "Uncommon", "Common"];
const rarityRank = (rarity: string | null) => (rarity && RARITY_ORDER.includes(rarity) ? RARITY_ORDER.indexOf(rarity) : RARITY_ORDER.length);
const setRank = (code: string) => (code in SET_NAMES ? Object.keys(SET_NAMES).indexOf(code) : Infinity);
const COLLECTION_RAREST = 5;
const WISHLIST_SHOWN = 10;

const cards = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "card" : "cards"}`;
const text = (content: string) => ({ type: ComponentType.TextDisplay as const, content });
const separator = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small } as const;

/** A private profile: nobody else could open the link, so only the caller hears what to change. */
function privateReply(what: string, siteUrl: string | null): string {
  const settings = siteUrl ? `${siteUrl.replace(/\/$/, "")}/settings#profile` : "/profile visibility";
  return `Your profile is private, so nobody else could open your ${what}: nothing was posted. Make it visible to your servers' members or to everyone under Profile on ${settings}, then share again.`;
}

/** The summary in its container, the members-only note, and the link button. */
function shared(sharer: Sharer, what: string, body: APIContainerComponent["components"], siteUrl: string | null): V2 {
  const page = siteUrl ? `${siteUrl.replace(/\/$/, "")}/u/${sharer.id}/${what}` : null;
  const note = sharer.visibility === "members" && page ? [separator, text(`-# The link opens only for members of ${escapeMarkdown(sharer.name)}'s servers.`)] : [];
  const container: APIContainerComponent = { type: ComponentType.Container, components: [...body, ...note] };
  const row: APIActionRowComponent<APIButtonComponent>[] = page
    ? [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: `Open ${what}`, url: page }] }]
    : [];
  return { components: [container, ...row], flags: MessageFlags.IsComponentsV2 };
}

/**
 * /collection share: the count per set and the rarest cards with their pictures, or for a
 * private profile the (ephemeral) text saying what to change.
 */
export function collectionShare(
  sharer: Sharer,
  owned: { printing_id: string; quantity: number }[],
  catalogue: Pick<Catalogue, "cards" | "printings">,
  emojis: Emojis,
  siteUrl: string | null,
): V2 | string {
  if (sharer.visibility !== "public" && sharer.visibility !== "members") return privateReply("collection", siteUrl);
  const printings = new Map(catalogue.printings.map((p) => [p.id, p]));
  const byCard = new Map(catalogue.cards.map((c) => [c.id, c]));
  const total = owned.reduce((n, c) => n + c.quantity, 0);
  const perSet = new Map<string, number>();
  for (const c of owned) {
    const set = printings.get(c.printing_id)?.set_code ?? "?";
    perSet.set(set, (perSet.get(set) ?? 0) + c.quantity);
  }
  const sets = [...perSet]
    .sort(([a], [b]) => setRank(a) - setRank(b) || a.localeCompare(b))
    .map(([set, n]) => `**${escapeMarkdown(set)}**${SET_NAMES[set] ? ` ${SET_NAMES[set]}` : ""} · ${cards(n)}`);
  const rarest = [...new Set(owned.map((c) => c.printing_id))]
    .flatMap((id) => {
      const p = printings.get(id);
      const card = p && byCard.get(p.card_id);
      return p && card ? [{ p, card }] : [];
    })
    .sort((a, b) => rarityRank(a.p.rarity) - rarityRank(b.p.rarity) || byPrinting(a.p, b.p))
    .slice(0, COLLECTION_RAREST)
    .map(({ p, card }) => {
      const rarity = p.rarity ? emoji(emojis, `rb_${p.rarity.toLowerCase()}`) : null;
      const line = [rarity, `**${escapeMarkdown(card.name)}**`].filter(Boolean).join(" ");
      return withThumbnail(`${line}\n-# ${[p.rarity, escapeMarkdown(p.collector_code)].filter(Boolean).join(" · ")}`, imageOf(catalogue, card, 160, p.id), card.name);
    });
  const heading = text(`### ${escapeMarkdown(sharer.name)}'s collection · ${cards(total)}`);
  const body = total ? [heading, text(sets.join("\n")), ...(rarest.length ? [separator, text("**Rarest**"), ...rarest] : [])] : [heading, text("Nothing in it yet.")];
  return shared(sharer, "collection", body, siteUrl);
}

/**
 * /wishlist share: the first wanted cards by name with their counts, or for a private profile
 * the (ephemeral) text saying what to change.
 */
export function wishlistShare(sharer: Sharer, wanted: Wanted[], catalogue: Pick<Catalogue, "cards" | "printings">, emojis: Emojis, siteUrl: string | null): V2 | string {
  if (sharer.visibility !== "public" && sharer.visibility !== "members") return privateReply("wishlist", siteUrl);
  const byCard = new Map(catalogue.cards.map((c) => [c.id, c]));
  const name = (id: string) => byCard.get(id)?.name ?? id;
  const rows = wanted.filter((w) => w.wanted > 0).sort((a, b) => name(a.card_id).localeCompare(name(b.card_id)));
  const total = rows.reduce((n, w) => n + w.wanted, 0);
  const lines = rows.slice(0, WISHLIST_SHOWN).map((w) => {
    const domains = (byCard.get(w.card_id)?.domains ?? []).map((d) => emoji(emojis, `rb_${d.toLowerCase()}`)).filter(Boolean).join("");
    const code = w.printing_id && catalogue.printings.find((p) => p.id === w.printing_id)?.collector_code;
    const pin = code ? ` · only ${escapeMarkdown(code)}` : "";
    return `${w.wanted}× **${escapeMarkdown(name(w.card_id))}**${domains ? ` ${domains}` : ""}${pin}`;
  });
  const more = rows.length > WISHLIST_SHOWN ? [`-# and ${rows.length - WISHLIST_SHOWN} more on the wishlist's page`] : [];
  const heading = text(`### ${escapeMarkdown(sharer.name)}'s wishlist · ${cards(total)}`);
  return shared(sharer, "wishlist", [heading, text(lines.length ? [...lines, ...more].join("\n") : "Nothing wanted right now.")], siteUrl);
}
