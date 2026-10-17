import { describe, expect, it } from "vitest";
import { reportCardEmbed, reportWeek, type ReportCard } from "./report.js";

describe("reportWeek", () => {
  it.each([
    // Summer time (UTC+2): due at 07:00 UTC.
    ["2026-10-12T06:59:59Z", "2026-09-28"],
    ["2026-10-12T07:00:00Z", "2026-10-05"],
    ["2026-10-17T10:00:00Z", "2026-10-05"], // Saturday after
    // Winter time (UTC+1): due at 08:00 UTC, the Monday right after the October switch.
    ["2026-10-26T07:59:59Z", "2026-10-12"],
    ["2026-10-26T08:00:00Z", "2026-10-19"],
    // Monday right after the March switch to summer time.
    ["2026-03-30T06:59:59Z", "2026-03-16"],
    ["2026-03-30T07:00:00Z", "2026-03-23"],
    // Already Monday in Brussels but still Sunday in UTC: not due yet.
    ["2026-11-01T23:30:00Z", "2026-10-19"],
    // Across a year.
    ["2027-01-04T08:00:00Z", "2026-12-28"],
  ])("%s -> %s", (now, week) => {
    expect(reportWeek(new Date(now))).toBe(week);
  });
});

const card: ReportCard = {
  top_talkers: [
    { display_name: "Alice", message_count: 1234 },
    { display_name: "Bob", message_count: 56 },
    { display_name: "Cleo", message_count: 7 },
  ],
  busiest_channel: { name: "general", message_count: 900 },
  top_emoji: { emoji_key: "1", emoji_id: "1", name: "pog", animated: true, reaction_count: 42 },
  joins: 5,
  leaves: 2,
};

const field = (embed: ReturnType<typeof reportCardEmbed>, name: string) =>
  embed.fields?.find((f) => f.name === name)?.value;

describe("reportCardEmbed", () => {
  it("shows every stat for the week", () => {
    const embed = reportCardEmbed("2026-10-05", card);
    expect(embed.title).toBe("Weekly report card: 2026-10-05 to 2026-10-11");
    expect(field(embed, "Top talkers")).toContain(
      "**1.** Alice: 1,234 messages\n**2.** Bob: 56 messages\n**3.** Cleo: 7 messages",
    );
    expect(field(embed, "Busiest channel")).toContain("#general: 900 messages");
    expect(field(embed, "Top emoji")).toContain("<a:pog:1> used 42 times");
    expect(field(embed, "Member growth")).toContain("+3 (5 joined, 2 left)");
  });

  it("writes unicode emoji as-is", () => {
    const top_emoji = { emoji_key: "🔥", emoji_id: null, name: "🔥", animated: false, reaction_count: 3 };
    expect(field(reportCardEmbed("2026-10-05", { ...card, top_emoji }), "Top emoji")).toContain(
      "🔥 used 3 times",
    );
  });

  it("handles a week without activity", () => {
    const embed = reportCardEmbed("2026-10-05", {
      top_talkers: [],
      busiest_channel: null,
      top_emoji: null,
      joins: 0,
      leaves: 1,
    });
    expect(embed.description).toContain("disappointed");
    expect(field(embed, "Top talkers")).toBe("Nobody. Not one of you.");
    expect(field(embed, "Member growth")).toContain("-1 (0 joined, 1 left)");
  });
});
