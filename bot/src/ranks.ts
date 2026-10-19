/** The ranked queues shown, by Riot's queueType. */
export const QUEUES = { RANKED_SOLO_5x5: "Solo/Duo", RANKED_FLEX_SR: "Flex" } as const;
export type Queue = keyof typeof QUEUES;

/** Riot's tiers, lowest first. The rank roles are named after them. */
export const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** One League-V4 entry, as /lol/league/v4/entries/by-puuid returns it (fields used here). */
export interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
}

export interface RankRow {
  user_id: string;
  queue: Queue;
  tier: string;
  division: string | null;
  lp: number;
}

/** The rows to store: Riot's own tier, division and LP, for the queues shown. */
export function rankRows(userId: string, entries: readonly LeagueEntry[]): RankRow[] {
  return entries
    .filter((e) => Object.hasOwn(QUEUES, e.queueType) && TIERS.includes(e.tier))
    .map((e) => ({
      user_id: userId,
      queue: e.queueType as Queue,
      tier: e.tier,
      // Riot sends "I" for the apex tiers, which have no divisions.
      division: APEX.has(e.tier) ? null : e.rank,
      lp: e.leaguePoints,
    }));
}

/** "GOLD" -> "Gold": the role name. */
export function tierName(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

/** The tier a member's role shows: Solo/Duo, else Flex, else none. */
export function roleTier(ranks: readonly Pick<RankRow, "queue" | "tier">[]): string | null {
  return (ranks.find((r) => r.queue === "RANKED_SOLO_5x5") ?? ranks.find((r) => r.queue === "RANKED_FLEX_SR"))?.tier ?? null;
}

/**
 * Why the bot cannot keep rank roles here, or null when it can. A bot only manages roles
 * below its own highest role, so every existing rank role must sit under it.
 */
export function rankRolesProblem(canManageRoles: boolean, botPosition: number, rankRoles: readonly { name: string; position: number }[]): string | null {
  if (!canManageRoles) {
    return "I need the Manage Roles permission for rank roles. Give my role that permission and try again; until then, ranks stay on the website.";
  }
  const above = rankRoles.filter((r) => r.position >= botPosition).map((r) => r.name);
  if (above.length) {
    return `My role must be above the rank roles to manage them, and ${above.join(", ")} ${above.length === 1 ? "is" : "are"} not below it. Move my role up in Server Settings > Roles and try again; until then, ranks stay on the website.`;
  }
  return null;
}

/** Role changes that leave a member with only `want` of the rank roles (role id -> tier). */
export function roleChanges(has: ReadonlySet<string>, want: string | null, rankRoleIds: readonly string[]): { add: string[]; remove: string[] } {
  return {
    add: want && !has.has(want) ? [want] : [],
    remove: rankRoleIds.filter((id) => id !== want && has.has(id)),
  };
}
