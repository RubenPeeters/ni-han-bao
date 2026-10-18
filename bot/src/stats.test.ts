import { describe, expect, it } from "vitest";
import {
  busiestHour,
  channelEmbed,
  leaderboardEmbed,
  meEmbed,
  rankOf,
  sumSince,
} from "./stats.js";

const SITE = "https://nihanbao.example/";
const rows = [
  { user_id: "a", display_name: "Alice", message_count: 1200 },
  { user_id: "b", display_name: "Bob", message_count: 30 },
  { user_id: "c", display_name: "Cleo", message_count: 30 },
];

describe("sumSince", () => {
  const days = [
    { day: "2026-10-01", count: 5 },
    { day: "2026-10-12", count: 2 },
    { day: "2026-10-15", count: 3 },
  ];
  it("sums every day when since is null", () => expect(sumSince(days, null)).toBe(10));
  it("includes the since day itself", () => expect(sumSince(days, "2026-10-12")).toBe(5));
});

describe("rankOf", () => {
  it("lets ties share a rank", () => {
    expect(rankOf(rows, "b", 30)).toBe(2);
    expect(rankOf(rows, "c", 30)).toBe(2);
  });
  it("ranks a hidden caller who is not in the rows", () => {
    expect(rankOf(rows, "h", 31)).toBe(2);
  });
  it("gives no rank without messages", () => {
    expect(rankOf(rows, "h", 0)).toBeNull();
  });
});

describe("busiestHour", () => {
  it("adds the same hour across days", () => {
    expect(
      busiestHour([
        { hour: "2026-10-15T09:00:00+00:00", count: 4 },
        { hour: "2026-10-15T21:00:00+00:00", count: 5 },
        { hour: "2026-10-16T09:00:00+00:00", count: 3 },
      ], "UTC"),
    ).toBe(9);
  });
  it("uses the server's time zone", () => {
    expect(busiestHour([{ hour: "2026-10-15T09:00:00+00:00", count: 1 }], "Europe/Brussels")).toBe(11);
  });
  it("is null without messages", () => expect(busiestHour([], "UTC")).toBeNull());
});

describe("leaderboardEmbed", () => {
  it("numbers the rows and links the leaderboard page", () => {
    expect(leaderboardEmbed("week", rows, "2026-10-12", SITE, "Europe/Brussels")).toEqual({
      title: "Leaderboard: this week",
      url: "https://nihanbao.example/leaderboard",
      description: "**1.** Alice: 1,200\n**2.** Bob: 30\n**3.** Cleo: 30",
      footer: { text: "Since Monday 2026-10-12 (Europe/Brussels)" },
    });
  });
  it("has no week footer for all time, and no link without a site url", () => {
    expect(leaderboardEmbed("all", [], "2026-10-12", null, "UTC")).toEqual({
      title: "Leaderboard: all time",
      description: "No messages counted yet.",
    });
  });
});

describe("meEmbed", () => {
  const stats = {
    displayName: "Bob",
    week: 0,
    allTime: 30,
    weekRank: null,
    allTimeRank: 2,
    reactionsReceived: 7,
    hidden: false,
  };
  it("shows counts with ranks where there are any", () => {
    expect(meEmbed(stats, SITE)).toEqual({
      title: "Stats for Bob",
      url: "https://nihanbao.example/leaderboard",
      fields: [
        { name: "Messages this week", value: "0", inline: true },
        { name: "Messages all time", value: "30 (rank #2)", inline: true },
        { name: "Reactions received", value: "7", inline: true },
      ],
    });
  });
  it("reminds a hidden caller that they are hidden", () => {
    expect(meEmbed({ ...stats, hidden: true }, SITE).footer?.text).toMatch(/hidden/);
  });
});

describe("channelEmbed", () => {
  it("shows the total and busiest hour and links the channels page", () => {
    expect(
      channelEmbed("general", [{ hour: "2026-10-15T23:00:00Z", count: 2_500 }], SITE, "UTC"),
    ).toEqual({
      title: "#general",
      url: "https://nihanbao.example/channels",
      fields: [
        { name: "Messages, last 30 days", value: "2,500", inline: true },
        { name: "Busiest hour", value: "23:00-00:00 UTC", inline: true },
      ],
    });
  });
  it("handles a channel without messages", () => {
    expect(channelEmbed("quiet", [], null, "UTC").fields?.[1].value).toBe("None yet");
  });
});
