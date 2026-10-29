// The daily check of Riot's card feed (#204): what differs from the catalogue in the database,
// and the DMs that ask the bot's owner to accept it.
import { ButtonStyle, ComponentType, MessageFlags, type APIComponentInContainer, type APITextDisplayComponent } from "discord.js";
import { createHash } from "node:crypto";
import { byPrinting, cardImageUrl } from "./card-match.js";
import { type V2 } from "./riftbound-reply.js";
import { findingText, type Finding } from "./riftbound-checks.js";
import { cardsJson, SET_ORDER, type FeedCard, type FeedCatalogue, type FeedIcon, type FeedPrinting } from "./riftbound-feed.js";

export const CARD_COLUMNS = "id, name, type, supertypes, domains, energy, might, tags, rules_text, placeholder";
export const PRINTING_COLUMNS =
  "id, card_id, set_code, collector_code, collector_number, rarity, illustrator, image_url, rules_text, effect_text";
export const ICON_COLUMNS = "facet, value, label, icon_url, color_primary, color_secondary";

export interface SetDiff {
  set: string;
  // Card names.
  added: string[];
  changed: string[];
  gone: string[];
}

export interface CatalogueDiff {
  sets: SetDiff[];
  // The rows Accept upserts: new or different. Cards gone from the feed are never deleted.
  cards: FeedCard[];
  printings: FeedPrinting[];
  // New or different icons (#218), upserted with the cards; none are deleted either.
  icons: FeedIcon[];
}

/** The content of a feed, whatever its build id: the manifest's sha256 for the same feed. */
export const checksum = (catalogue: FeedCatalogue) => createHash("sha256").update(cardsJson(catalogue)).digest("hex");

const same = <T extends object>(feed: T, stored: T | undefined) =>
  stored !== undefined &&
  Object.entries(feed).every(([k, v]) => JSON.stringify(v) === JSON.stringify((stored as Record<string, unknown>)[k] ?? null));

/**
 * The feed against the stored rows. A card is changed when its row or one of its printings
 * differs or is new. Placeholders were never in the feed, so they are not "gone". Each card
 * counts under the set of its newest printing.
 */
export function diffCatalogue(
  feed: Pick<FeedCatalogue, "cards" | "printings" | "icons">,
  stored: { cards: FeedCard[]; printings: FeedPrinting[]; icons: FeedIcon[] },
): CatalogueDiff {
  const storedCards = new Map(stored.cards.map((c) => [c.id, c]));
  const storedPrintings = new Map(stored.printings.map((p) => [p.id, p]));
  const newest = (printings: FeedPrinting[]) => {
    const sets = new Map<string, string>();
    for (const p of printings) {
      const was = sets.get(p.card_id);
      if (was === undefined || SET_ORDER.indexOf(p.set_code) > SET_ORDER.indexOf(was)) sets.set(p.card_id, p.set_code);
    }
    return sets;
  };
  const feedSets = newest(feed.printings);
  const storedSets = newest(stored.printings);

  const printings = feed.printings.filter((p) => !same(p, storedPrintings.get(p.id)));
  const cards = feed.cards.filter((c) => !same(c, storedCards.get(c.id)));
  const storedIcons = new Map(stored.icons.map((i) => [`${i.facet}:${i.value}`, i]));
  const icons = feed.icons.filter((i) => !same(i, storedIcons.get(`${i.facet}:${i.value}`)));
  const changed = new Set([...printings.map((p) => p.card_id), ...cards.map((c) => c.id)]);
  const feedIds = new Set(feed.cards.map((c) => c.id));

  const bySet = new Map<string, SetDiff>();
  const entry = (set: string) => bySet.get(set) ?? bySet.set(set, { set, added: [], changed: [], gone: [] }).get(set)!;
  for (const c of feed.cards) {
    if (!storedCards.has(c.id)) entry(feedSets.get(c.id) ?? "?").added.push(c.name);
    else if (changed.has(c.id)) entry(feedSets.get(c.id) ?? "?").changed.push(c.name);
  }
  for (const c of stored.cards) {
    if (!c.placeholder && !feedIds.has(c.id)) entry(storedSets.get(c.id) ?? "?").gone.push(c.name);
  }
  const rank = (s: string) => (SET_ORDER.includes(s) ? SET_ORDER.indexOf(s) : SET_ORDER.length);
  const sets = [...bySet.values()].sort((a, b) => rank(a.set) - rank(b.set) || (a.set < b.set ? -1 : 1));
  return { sets, cards, printings, icons };
}

export const proposalCounts = (diff: CatalogueDiff) => ({
  added: diff.sets.reduce((n, s) => n + s.added.length, 0),
  changed: diff.sets.reduce((n, s) => n + s.changed.length, 0),
  gone: diff.sets.reduce((n, s) => n + s.gone.length, 0),
});

const FIRST_NAMES = 3;
const some = (count: number, label: string, names: string[]) =>
  `${count} ${label}${names.length ? ` (${names.slice(0, FIRST_NAMES).join(", ")}${names.length > FIRST_NAMES ? ", …" : ""})` : ""}`;

// Media galleries take up to 10 images.
const GALLERY_MAX = 10;
// With their image URLs, within the message's 4000 characters; all of them are in the attached file.
const FIRST_FINDINGS = 5;
const FINDINGS_FILE = "findings.txt";

/**
 * The DM that asks the owner to accept a feed: per set its counts and new cards' pictures, the
 * feed's values another source disagrees with (#324), Accept and Reject.
 */
export function proposalMessage(
  buildId: string,
  diff: CatalogueDiff,
  proposal: number,
  findings: Finding[] = [],
): V2 & { files?: { attachment: Buffer; name: string }[] } {
  const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });
  const sets = diff.sets.flatMap((s): APIComponentInContainer[] => {
    const added = new Set(diff.cards.filter((c) => s.added.includes(c.name)).map((c) => c.id));
    const items = diff.printings
      .filter((p) => added.has(p.card_id) && p.set_code === s.set && p.image_url)
      .sort(byPrinting)
      .filter((p, i, all) => all.findIndex((q) => q.card_id === p.card_id) === i)
      .slice(0, GALLERY_MAX)
      .map((p) => ({ media: { url: cardImageUrl(p.image_url!, 300) }, description: diff.cards.find((c) => c.id === p.card_id)!.name }));
    const line = `**${s.set}**: ${some(s.added.length, "new", s.added)}, ${some(s.changed.length, "changed", s.changed)}, ${some(s.gone.length, "no longer in the feed", s.gone)}`;
    return [text(line), ...(items.length ? [{ type: ComponentType.MediaGallery as const, items }] : [])];
  });
  const icons = diff.icons.length ? [text(some(diff.icons.length, "new or changed icons", diff.icons.map((i) => i.label)))] : [];
  const checks = findings.length
    ? [text([
        `${findings.length} value${findings.length === 1 ? "" : "s"} in the feed disagree with another source:`,
        ...findings.slice(0, FIRST_FINDINGS).map((f) => `- ${findingText(f)}`),
        ...(findings.length > FIRST_FINDINGS ? [`- and ${findings.length - FIRST_FINDINGS} more; all of them are in ${FINDINGS_FILE}`] : []),
      ].join("\n")),
      // A components message shows an attachment only through a File component.
      { type: ComponentType.File as const, file: { url: `attachment://${FINDINGS_FILE}` } }]
    : [];
  const changed = diff.sets.length > 0 || diff.icons.length > 0;
  return {
    components: [
      {
        type: ComponentType.Container,
        components: [
          text(`Riot's Riftbound card feed (build \`${buildId}\`) ${changed ? "differs from" : "matches"} the catalogue.`),
          ...sets,
          ...icons,
          ...checks,
          text("Accept writes the new and changed cards. Cards no longer in the feed stay: collections, decks and loans point at them."),
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, custom_id: proposalButtonId("accept", proposal), label: "Accept", style: ButtonStyle.Success },
          { type: ComponentType.Button, custom_id: proposalButtonId("reject", proposal), label: "Reject", style: ButtonStyle.Danger },
        ],
      },
    ],
    flags: MessageFlags.IsComponentsV2,
    ...(findings.length
      ? { files: [{ attachment: Buffer.from(`${findings.map(findingText).join("\n")}\n`), name: FINDINGS_FILE }] }
      : {}),
  };
}

/** The DM when the feed cannot be read; the database is left untouched. */
export const brokenText = (error: unknown) =>
  `Riot's Riftbound card feed could not be read, so the catalogue is unchanged: ${
    error instanceof Error ? error.message : String(error)
  }`.slice(0, 2000);

const PROPOSAL_ID = /^catalogue-(accept|reject):(\d+)$/;
export const proposalButtonId = (kind: "accept" | "reject", proposal: number) => `catalogue-${kind}:${proposal}`;
export function parseProposalButtonId(customId: string): { kind: "accepted" | "rejected"; proposal: number } | null {
  const m = PROPOSAL_ID.exec(customId);
  return m ? { kind: m[1] === "accept" ? "accepted" : "rejected", proposal: Number(m[2]) } : null;
}
