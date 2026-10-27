import { describe, expect, it } from "vitest";
import { rankChanges, rankRolesProblem, rankRows, roleChanges, roleTier, tierName } from "./ranks.js";

describe("rankRows", () => {
  it("keeps Riot's tier, division and LP for Solo/Duo and Flex only", () => {
    expect(
      rankRows("u", [
        { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: 47 },
        { queueType: "RANKED_FLEX_SR", tier: "MASTER", rank: "I", leaguePoints: 120 },
        { queueType: "CHERRY", tier: "GOLD", rank: "I", leaguePoints: 0 },
      ]),
    ).toEqual([
      { user_id: "u", queue: "RANKED_SOLO_5x5", tier: "GOLD", division: "II", lp: 47 },
      { user_id: "u", queue: "RANKED_FLEX_SR", tier: "MASTER", division: null, lp: 120 },
    ]);
  });

  it("drops a tier it does not know", () => {
    expect(rankRows("u", [{ queueType: "RANKED_SOLO_5x5", tier: "WOOD", rank: "I", leaguePoints: 0 }])).toEqual([]);
  });
});

describe("rankChanges", () => {
  const row = (queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR", tier: string, division: string | null, lp = 0) => ({ user_id: "u", queue, tier, division, lp });

  it("records a baseline for a queue with no history", () => {
    expect(rankChanges([], [row("RANKED_SOLO_5x5", "GOLD", "II", 47)])).toEqual([row("RANKED_SOLO_5x5", "GOLD", "II", 47)]);
  });

  it("records a promotion and a demotion, by division or tier", () => {
    expect(rankChanges([row("RANKED_SOLO_5x5", "GOLD", "III")], [row("RANKED_SOLO_5x5", "GOLD", "II")])).toHaveLength(1);
    expect(rankChanges([row("RANKED_SOLO_5x5", "GOLD", "IV")], [row("RANKED_SOLO_5x5", "SILVER", "I")])).toHaveLength(1);
  });

  it("ignores a change of LP alone", () => {
    expect(rankChanges([row("RANKED_SOLO_5x5", "GOLD", "II", 10)], [row("RANKED_SOLO_5x5", "GOLD", "II", 90)])).toEqual([]);
  });

  it("compares apex tiers, which have no division, by tier", () => {
    expect(rankChanges([row("RANKED_SOLO_5x5", "MASTER", null, 50)], [row("RANKED_SOLO_5x5", "MASTER", null, 300)])).toEqual([]);
    expect(rankChanges([row("RANKED_SOLO_5x5", "MASTER", null)], [row("RANKED_SOLO_5x5", "GRANDMASTER", null)])).toHaveLength(1);
    expect(rankChanges([row("RANKED_SOLO_5x5", "DIAMOND", "I")], [row("RANKED_SOLO_5x5", "MASTER", null)])).toHaveLength(1);
  });

  it("compares each queue with its own history", () => {
    expect(
      rankChanges([row("RANKED_SOLO_5x5", "GOLD", "II")], [row("RANKED_SOLO_5x5", "GOLD", "II"), row("RANKED_FLEX_SR", "GOLD", "II")]),
    ).toEqual([row("RANKED_FLEX_SR", "GOLD", "II")]);
  });
});

it("names roles after the tier", () => expect(tierName("GRANDMASTER")).toBe("Grandmaster"));

describe("roleTier", () => {
  it("prefers Solo/Duo, then Flex", () => {
    expect(roleTier([{ queue: "RANKED_FLEX_SR", tier: "GOLD" }, { queue: "RANKED_SOLO_5x5", tier: "IRON" }])).toBe("IRON");
    expect(roleTier([{ queue: "RANKED_FLEX_SR", tier: "GOLD" }])).toBe("GOLD");
    expect(roleTier([])).toBeNull();
  });
});

describe("rankRolesProblem", () => {
  const role = (name: string, position: number) => ({ name, position, managed: false, grantsAccess: false });

  it("needs Manage Roles", () => {
    expect(rankRolesProblem(false, 10, [])).toMatch(/Manage Roles/);
  });

  it("needs the bot's role above every rank role", () => {
    expect(rankRolesProblem(true, 5, [role("Gold", 5), role("Iron", 2)])).toMatch(/Gold is not below/);
    expect(rankRolesProblem(true, 5, [role("Gold", 4)])).toBeNull();
  });

  it("refuses an existing tier-named role that grants access or is managed", () => {
    expect(rankRolesProblem(true, 5, [{ ...role("Gold", 1), grantsAccess: true }])).toMatch(/Gold is managed by an integration or grants/);
    expect(rankRolesProblem(true, 5, [{ ...role("Gold", 1), managed: true }, { ...role("Iron", 1), grantsAccess: true }])).toMatch(/Gold, Iron are/);
  });
});

describe("roleChanges", () => {
  const ids = ["iron", "gold"];

  it("swaps the old rank role for the new one", () => {
    expect(roleChanges(new Set(["iron", "other"]), "gold", ids)).toEqual({ add: ["gold"], remove: ["iron"] });
  });

  it("changes nothing when it already matches", () => {
    expect(roleChanges(new Set(["gold"]), "gold", ids)).toEqual({ add: [], remove: [] });
  });

  it("removes every rank role without a rank", () => {
    expect(roleChanges(new Set(["gold", "other"]), null, ids)).toEqual({ add: [], remove: ["gold"] });
  });
});
