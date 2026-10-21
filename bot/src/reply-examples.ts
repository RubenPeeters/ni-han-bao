// The bot replies the docs draw (lib/replies.json), made by the real reply builders from
// demo data, so the docs show what the bot says today. Only the demo data is written here:
// the demo server's people and stores (supabase/seed.sql), so the drawings match the screenshots.
import type { APIEmbed } from "discord.js";
import { readFileSync } from "node:fs";
import { goingMessage } from "./events.js";
import { FORGET_PROMPT } from "./forget.js";
import { challengeText } from "./lol.js";
import { recapMessage } from "./recap.js";
import { reportEmbed } from "./report.js";
import { type Catalogue } from "./riftbound.js";
import { cardMessage } from "./riftbound-reply.js";
import { deckMessage } from "./decks.js";
import { addedMessage } from "./collection.js";
import { lendAnnouncement } from "./lending.js";
import { tradeDm } from "./trades.js";
import type { FeedIcon } from "./riftbound-feed.js";
import { wantedEmojis } from "./emojis.js";
import { settingsText } from "./setup.js";
import { leaderboardEmbed } from "./stats.js";
import { welcomeText } from "./welcome.js";

export interface ReplyExample {
  /** The slash command the reply answers, as typed; null for a message the bot posts by itself. */
  command: string | null;
  /** Only the person who ran the command sees it. */
  ephemeral: boolean;
  /** Names for the channel mentions (<#id>) in the reply. */
  channels: Record<string, string>;
  /** Names for the member mentions (<@id>) in the reply. */
  users: Record<string, string>;
  /** The icon each application emoji (<:rb_fury:id>) in the reply was made from. */
  emojis: Record<string, string>;
  message: { content?: string; embeds?: APIEmbed[]; components?: unknown[]; flags?: number };
}

const SITE = "https://ni-han-bao.example";
const ZONE = "Europe/Brussels";
const GUILD = "900000000000000001";
const REPORT_CHANNEL = "900000000000000201";
const SATURDAY = "2026-10-17T17:00:00Z";
const reply = (command: string | null, message: ReplyExample["message"], more: Partial<ReplyExample> = {}): ReplyExample =>
  ({ command, ephemeral: false, channels: {}, users: {}, emojis: {}, message, ...more });
// The demo server's first members (supabase/seed.sql).
const [ANNA, BRAM, CHLOE] = ["900000000000000101", "900000000000000102", "900000000000000103"];
const USERS = { [ANNA]: "Anna", [BRAM]: "Bram", [CHLOE]: "Chloé" };

export function replyExamples(): Record<string, ReplyExample> {
  // Riot's Ahri Legend, the tutorial's deck (#206).
  const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue & { icons: FeedIcon[] };
  const card = catalogue.cards.find((c) => c.id === "nine-tailed-fox")!;
  // Demo ids: the real ones are the bot's own, made on start.
  const emojis = wantedEmojis(catalogue.icons);
  const emojiIds = new Map(emojis.map((e, i) => [e.name, `9000000000000003${String(i).padStart(2, "0")}`]));
  const { files: _image, ...recap } = recapMessage("2026-09-01", Buffer.alloc(0), `${SITE}/recap`);
  const going = goingMessage(1, { game: "Riftbound", name: "The Card Corner", city: "Leuven" }, SATURDAY, ZONE, null);
  // Anna's "Ahri control" (supabase/seed.sql): its main deck's 13 cards without a champion or
  // signature, in the Legend's domains, by id; runes and battlefields as seeded.
  const main = catalogue.cards
    .filter((c) => ["Unit", "Spell", "Gear"].includes(c.type) && !c.supertypes.length && c.domains.every((d) => card.domains.includes(d)))
    .map((c) => c.id)
    .sort()
    .slice(0, 13);
  const deckEntries = [
    { section: "main", card_id: "ahri-alluring", printing_id: "ogn-066-298", quantity: 1 },
    ...main.map((id) => ({ section: "main", card_id: id, printing_id: null, quantity: 3 })),
    { section: "runes", card_id: "calm-rune", printing_id: null, quantity: 6 },
    { section: "runes", card_id: "mind-rune", printing_id: null, quantity: 6 },
    ...["abandoned-hall", "altar-to-unity", "aspirants-climb"].map((id) => ({ section: "battlefields", card_id: id, printing_id: null, quantity: 1 })),
  ];
  const deck = {
    id: "00000000-0000-4000-8000-0000000d0001", name: "Ahri control", legend_id: card.id, champion_id: "ahri-alluring",
    visibility: "public", language: "en", allow_other_languages: true,
  };
  const iconUrls = Object.fromEntries(emojis.map((e) => [e.name, e.url]));
  const cardOf = (id: string) => catalogue.cards.find((c) => c.id === id)!;
  // Anna adds two French copies of Ahri, Alluring to the two she had.
  const ahri = cardOf("ahri-alluring");
  const added = addedMessage(ahri, catalogue.printings.find((p) => p.id === "ogn-066-298")!, 2, 4, "fr", emojiIds, SITE);
  // Bram and Chloé have cards on Anna's wishlist for trade, as seeded; they are regulars at The Card Corner.
  const place = { place_kind: "regulars" as const, event_name: null, starts_at: null, store_name: "The Card Corner", store_city: "Leuven" };
  const trades = tradeDm(
    [
      { guild_id: GUILD, trader_id: BRAM, card_id: "ahri-alluring", copies: 2, wanted: 3, ...place },
      { guild_id: GUILD, trader_id: CHLOE, card_id: "dark-child-starter", copies: 1, wanted: 1, ...place },
    ],
    catalogue, emojiIds, () => ZONE, SITE,
  );
  const rows = [
    { user_id: "1", display_name: "Anna", message_count: 1284 },
    { user_id: "2", display_name: "Bram", message_count: 967 },
    { user_id: "3", display_name: "Chloé", message_count: 412 },
  ];
  return {
    welcome: reply(null, { content: welcomeText(SITE, GUILD) }),
    leaderboard: reply("/leaderboard", { embeds: [leaderboardEmbed("week", rows, "2026-10-12", SITE, ZONE)] }),
    setup: reply(
      "/setup show",
      { content: settingsText({ report_channel_id: REPORT_CHANNEL, timezone: ZONE, public_totals_opt_out: true, rank_roles: false }) },
      { ephemeral: true, channels: { [REPORT_CHANNEL]: "weekly-report" } },
    ),
    report: reply(null, {
      embeds: [
        reportEmbed(
          "2026-10-12",
          {
            top_talkers: rows,
            busiest_channel: { name: "general", message_count: 1712 },
            top_emoji: { emoji_key: "😂", emoji_id: null, name: null, animated: false, reaction_count: 58 },
            joins: 3,
            leaves: 1,
          },
          SITE,
          ZONE,
          [{ id: 1, name: "Riftbound Nexus Night", starts_at: SATURDAY, url: null, store_name: "The Card Corner", store_city: "Leuven", going: ["Anna", "Bram"] }],
          [{ display_name: "Bram", games: 14, champion: "Ahri" }],
        ),
      ],
    }),
    recap: reply("/recap", recap),
    card: reply(
      "/card",
      cardMessage(card, catalogue.printings.filter((p) => p.card_id === card.id), catalogue.icons, emojiIds, SITE),
      { emojis: Object.fromEntries(emojis.map((e) => [e.name, e.url])) },
    ),
    "deck-share": reply(
      "/deck share",
      deckMessage(deck, deckEntries, catalogue, catalogue.icons, emojiIds, "Anna", 5, SITE),
      { emojis: Object.fromEntries(emojis.map((e) => [e.name, e.url])) },
    ),
    "collection-add": reply("/collection add", added, { ephemeral: true, emojis: iconUrls }),
    lend: reply(
      "/lend",
      lendAnnouncement(
        { loan: 12, lender: ANNA, borrower: CHLOE, cards: [{ card: ahri, count: 2 }, { card, count: 1 }], due: "2026-11-02", deck: null },
        catalogue,
        emojiIds,
      ),
      { users: USERS, emojis: iconUrls },
    ),
    "trade-match": reply(null, trades, { users: USERS, emojis: iconUrls }),
    going: reply("/event going", going),
    "lol-link": reply(
      "/lol link",
      {
        content: challengeText({ puuid: "demo", riotId: "Anna#EUW", platform: "euw1", icon: 7 }),
        // The Verify button is built in index.ts; the icon image is left out (its URL needs Data Dragon).
        components: [{ components: [{ label: "Verify", style: 1 }] }],
      },
      { ephemeral: true },
    ),
    "forget-me": reply(
      "/forget-me",
      // The buttons are built in index.ts.
      { content: FORGET_PROMPT, components: [{ components: [{ label: "Delete my data", style: 4 }, { label: "Cancel", style: 2 }] }] },
      { ephemeral: true },
    ),
  };
}

export const EXAMPLES_PATH = new URL("../../lib/replies.json", import.meta.url);
