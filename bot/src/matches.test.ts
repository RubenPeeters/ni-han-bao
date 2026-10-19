import { describe, expect, it } from "vitest";
import { allIds, matchIdsPath, matchRegion, matchRow, type Match } from "./matches.js";

describe("matchRegion", () => {
  it.each([
    ["euw1", "europe"],
    ["na1", "americas"],
    ["kr", "asia"],
    ["oc1", "sea"],
    ["vn2", "sea"],
  ])("%s -> %s", (platform, region) => expect(matchRegion(platform)).toBe(region));
});

describe("matchIdsPath", () => {
  it("asks for one type since a time, in seconds", () => {
    expect(matchIdsPath("a/b", "ranked", 1_760_000_000_999, 200)).toBe(
      "/lol/match/v5/matches/by-puuid/a%2Fb/ids?type=ranked&startTime=1760000000&start=200&count=100",
    );
  });
});

describe("allIds", () => {
  const history = Array.from({ length: 250 }, (_, i) => `m${i}`);
  it("pages until a short page", async () => {
    const starts: number[] = [];
    const ids = await allIds(async (start) => (starts.push(start), history.slice(start, start + 100)));
    expect(ids).toEqual(history);
    expect(starts).toEqual([0, 100, 200]);
  });
  it("stops on an empty page after a full one, and on a missing one", async () => {
    expect(await allIds(async (start) => history.slice(start, start + 100).slice(0, start < 200 ? 100 : 0))).toHaveLength(200);
    expect(await allIds(async () => null)).toEqual([]);
  });
});

const match = (queueId: number): Match => ({
  metadata: { matchId: "EUW1_1" },
  info: {
    queueId,
    gameCreation: 1_760_000_000_000,
    gameStartTimestamp: 1_760_000_060_000,
    participants: [
      { puuid: "other", championName: "Lux" },
      { puuid: "me", championName: "Ahri" },
    ],
  },
});

describe("matchRow", () => {
  it("keeps the account's champion and the start time", () => {
    expect(matchRow("u", "me", match(420))).toEqual({
      user_id: "u",
      puuid: "me",
      match_id: "EUW1_1",
      queue_id: 420,
      champion: "Ahri",
      played_at: "2025-10-09T08:54:20.000Z",
    });
  });

  it("never keeps a custom game", () => expect(matchRow("u", "me", match(0))).toBeNull());

  it("skips a game the account was not in", () => expect(matchRow("u", "nobody", match(420))).toBeNull());
});
