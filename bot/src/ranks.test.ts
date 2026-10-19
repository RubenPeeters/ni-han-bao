import { describe, expect, it } from "vitest";
import { rankRolesProblem, rankRows, roleChanges, roleTier, tierName } from "./ranks.js";

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

it("names roles after the tier", () => expect(tierName("GRANDMASTER")).toBe("Grandmaster"));

describe("roleTier", () => {
  it("prefers Solo/Duo, then Flex", () => {
    expect(roleTier([{ queue: "RANKED_FLEX_SR", tier: "GOLD" }, { queue: "RANKED_SOLO_5x5", tier: "IRON" }])).toBe("IRON");
    expect(roleTier([{ queue: "RANKED_FLEX_SR", tier: "GOLD" }])).toBe("GOLD");
    expect(roleTier([])).toBeNull();
  });
});

describe("rankRolesProblem", () => {
  it("needs Manage Roles", () => {
    expect(rankRolesProblem(false, 10, [])).toMatch(/Manage Roles/);
  });

  it("needs the bot's role above every rank role", () => {
    expect(rankRolesProblem(true, 5, [{ name: "Gold", position: 5 }, { name: "Iron", position: 2 }])).toMatch(/Gold is not below/);
    expect(rankRolesProblem(true, 5, [{ name: "Gold", position: 4 }])).toBeNull();
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
