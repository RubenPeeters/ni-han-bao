import { describe, expect, it } from "vitest";
import { matchIdsPath, matchRegion, matchRow, type Match } from "./matches.js";

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
    expect(matchIdsPath("a/b", "ranked", 1_760_000_000_999)).toBe(
      "/lol/match/v5/matches/by-puuid/a%2Fb/ids?type=ranked&startTime=1760000000&count=100",
    );
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
