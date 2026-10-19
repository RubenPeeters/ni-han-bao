import { ApplicationCommandOptionType } from "discord.js";
import { STARTER_ICON_NAMES } from "./starter-icons.js";

/**
 * League platforms (Summoner-V4) and the regional route Account-V1 is asked through. Riot
 * accounts are global, so the nearest of americas, asia and europe works for every one.
 */
export const PLATFORMS = {
  euw1: { label: "Europe West", regional: "europe" },
  eun1: { label: "Europe Nordic & East", regional: "europe" },
  tr1: { label: "Türkiye", regional: "europe" },
  ru: { label: "Russia", regional: "europe" },
  me1: { label: "Middle East", regional: "europe" },
  na1: { label: "North America", regional: "americas" },
  br1: { label: "Brazil", regional: "americas" },
  la1: { label: "Latin America North", regional: "americas" },
  la2: { label: "Latin America South", regional: "americas" },
  kr: { label: "Korea", regional: "asia" },
  jp1: { label: "Japan", regional: "asia" },
  oc1: { label: "Oceania", regional: "asia" },
  sg2: { label: "Southeast Asia", regional: "asia" },
  tw2: { label: "Taiwan", regional: "asia" },
  vn2: { label: "Vietnam", regional: "asia" },
} as const;
export type Platform = keyof typeof PLATFORMS;

export const GAME = "lol";

export const LOL_COMMAND = {
  name: "lol",
  description: "Your League of Legends account",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "link",
      description: "Link your League account by changing your profile icon for a moment",
      options: [
        { type: ApplicationCommandOptionType.String, name: "riot-id", description: "GameName#TAG", required: true, max_length: 30 },
        {
          type: ApplicationCommandOptionType.String,
          name: "region",
          description: "The server you play League on",
          required: true,
          choices: Object.entries(PLATFORMS).map(([value, { label }]) => ({ name: label, value })),
        },
      ],
    },
    { type: ApplicationCommandOptionType.Subcommand, name: "unlink", description: "Unlink your League account" },
  ],
} as const;

/** Riot IDs: a game name of 3 to 16 characters and a tag line of 3 to 5. */
export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const at = input.lastIndexOf("#");
  const gameName = input.slice(0, at).trim();
  const tagLine = input.slice(at + 1).trim();
  if (at < 0 || gameName.length < 3 || gameName.length > 16 || tagLine.length < 3 || tagLine.length > 5) return null;
  return { gameName, tagLine };
}

/** Icons 0 to 28 are the starter icons every account owns, so anyone can set the one asked for. */
export function pickIcon(current: number, random: () => number = Math.random): number {
  const icon = Math.floor(random() * 28);
  // Skips the current one: 0..27 maps onto the 28 starter icons other than it.
  return icon >= current ? icon + 1 : icon;
}

export interface RiotLookup {
  /** Account-V1 by Riot ID; null when there is none. */
  account(regional: string, gameName: string, tagLine: string): Promise<{ puuid: string; gameName: string; tagLine: string } | null>;
  /** Summoner-V4 by PUUID: the current profile icon, null without a League account there. */
  icon(platform: Platform, puuid: string): Promise<number | null>;
}

export type Challenge = { puuid: string; riotId: string; platform: Platform; icon: number };

/** Looks the account up and picks the icon to set, or says why it cannot. Options are untrusted. */
export async function startLink(riot: RiotLookup, riotId: string, region: string): Promise<Challenge | string> {
  const id = parseRiotId(riotId);
  if (!id) return "That is not a Riot ID. Write it as GameName#TAG, as shown in the Riot client.";
  if (!Object.hasOwn(PLATFORMS, region)) return "Unknown region, nothing was linked.";
  const platform = region as Platform;
  const account = await riot.account(PLATFORMS[platform].regional, id.gameName, id.tagLine);
  if (!account) return `There is no Riot account named ${id.gameName}#${id.tagLine}.`;
  const name = `${account.gameName}#${account.tagLine}`;
  const current = await riot.icon(platform, account.puuid);
  if (current === null) return `${name} has no League account on ${PLATFORMS[platform].label}.`;
  return { puuid: account.puuid, riotId: name, platform, icon: pickIcon(current) };
}

export function challengeText(challenge: Challenge): string {
  return (
    `To prove ${challenge.riotId} is yours, set your League profile icon to ` +
    `**${STARTER_ICON_NAMES[challenge.icon]}** (icon ${challenge.icon}, a starter icon), then press Verify. ` +
    // The names are English: a client in another language shows translated ones.
    "Search for it by name in the client's icon picker, or pick the icon shown below. " +
    "It can take up to 5 minutes to show up. You can change it back afterwards."
  );
}

export interface LinkWriter {
  /** Store the verified account; false when the database skipped it (forgotten user). */
  link(userId: string, challenge: Challenge): Promise<boolean>;
}

/** After Verify: links the account when the icon matches; `done` says whether to stop waiting. */
export async function verifyLink(
  riot: RiotLookup,
  writer: LinkWriter,
  userId: string,
  challenge: Challenge,
): Promise<{ done: boolean; reply: string }> {
  const icon = await riot.icon(challenge.platform, challenge.puuid);
  if (icon !== challenge.icon) {
    return { done: false, reply: `${challengeText(challenge)}\n\nYour icon is not **${STARTER_ICON_NAMES[challenge.icon]}** (icon ${challenge.icon}) yet. It can take up to 5 minutes to show up, so try again in a minute or two.` };
  }
  if (!(await writer.link(userId, challenge))) {
    return { done: true, reply: "You asked to be forgotten, so nothing was saved. Use /show-me first." };
  }
  return { done: true, reply: `Linked: ${challenge.riotId} is your League account. Its ranks show on your profile and on the Ranked page of your servers, and its ranked and normal games in the weekly report. Use /lol unlink to undo it.` };
}
