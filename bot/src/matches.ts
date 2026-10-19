import { PLATFORMS, type Platform } from "./lol.js";

/** How far back games are fetched and kept: a week's report runs up to ~8.6 days after it starts. */
export const KEEP_MS = 10 * 24 * 60 * 60_000;

/**
 * Match-V5's types fetched: ranked and normal queues only. Custom games are neither, so they
 * are never fetched (Riot policy: customs are private unless the player opted in).
 */
export const MATCH_TYPES = ["ranked", "normal"] as const;

// Match-V5 serves Oceania and Southeast Asia from "sea", not Account-V1's "asia".
const SEA = new Set<string>(["oc1", "sg2", "tw2", "vn2"]);

/** The regional route Match-V5 is asked through for a platform. */
export function matchRegion(platform: string): string {
  if (SEA.has(platform)) return "sea";
  return Object.hasOwn(PLATFORMS, platform) ? PLATFORMS[platform as Platform].regional : "europe";
}

/** The ids of one type's games since `since` (ms), newest first. */
export function matchIdsPath(puuid: string, type: (typeof MATCH_TYPES)[number], since: number): string {
  // shortcut: one page of 100 games per type per 10 days; page with `start` if anyone plays more.
  return `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?type=${type}&startTime=${Math.floor(since / 1000)}&count=100`;
}

/** One Match-V5 match, as /lol/match/v5/matches/{id} returns it (fields used here). */
export interface Match {
  metadata: { matchId: string };
  info: {
    queueId: number;
    gameCreation: number;
    gameStartTimestamp?: number;
    participants: { puuid: string; championName: string }[];
  };
}

export interface MatchRow {
  user_id: string;
  puuid: string;
  match_id: string;
  queue_id: number;
  champion: string;
  played_at: string;
}

/** The row to store for the account's game, or null for a custom game or one it was not in. */
export function matchRow(userId: string, puuid: string, match: Match): MatchRow | null {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  // Queue 0 is a custom game: never stored, whatever the ids endpoint sent.
  if (!me || match.info.queueId === 0) return null;
  return {
    user_id: userId,
    puuid,
    match_id: match.metadata.matchId,
    queue_id: match.info.queueId,
    champion: me.championName,
    played_at: new Date(match.info.gameStartTimestamp || match.info.gameCreation).toISOString(),
  };
}
