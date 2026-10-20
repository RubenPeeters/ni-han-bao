// The bot replies the docs draw (lib/replies.json), made by the real reply builders from
// demo data, so the docs show what the bot says today. Only the demo data is written here:
// the demo server's people and stores (supabase/seed.sql), so the drawings match the screenshots.
import type { APIEmbed } from "discord.js";
import { goingMessage } from "./events.js";
import { FORGET_PROMPT } from "./forget.js";
import { challengeText } from "./lol.js";
import { recapMessage } from "./recap.js";
import { reportEmbed } from "./report.js";
import { cardEmbed, placeholderCatalogue } from "./riftbound.js";
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
  message: { content?: string; embeds?: APIEmbed[]; components?: unknown[] };
}

const SITE = "https://ni-han-bao.example";
const ZONE = "Europe/Brussels";
const GUILD = "900000000000000001";
const REPORT_CHANNEL = "900000000000000201";
const SATURDAY = "2026-10-17T17:00:00Z";
const reply = (command: string | null, message: ReplyExample["message"], more: Partial<ReplyExample> = {}): ReplyExample =>
  ({ command, ephemeral: false, channels: {}, message, ...more });

export function replyExamples(): Record<string, ReplyExample> {
  const catalogue = placeholderCatalogue([{ id: "Ahri", key: "103", name: "Ahri" }]);
  const card = catalogue.cards.find((c) => c.id === "placeholder-legend-ahri")!;
  const { files: _image, ...recap } = recapMessage("2026-09-01", Buffer.alloc(0), `${SITE}/recap`);
  const going = goingMessage(1, { game: "Riftbound", name: "The Card Corner", city: "Leuven" }, SATURDAY, ZONE, null);
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
    card: reply("/card", { embeds: [cardEmbed(card, catalogue.printings.filter((p) => p.card_id === card.id), SITE)] }),
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
