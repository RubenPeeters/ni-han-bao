import { describe, expect, it } from "vitest";
import {
  addDays,
  dueReportWeek,
  isReportFor,
  PAGE_SIZE,
  postedSince,
  reportEmbed,
  reportSlot,
  type ReportData,
} from "./report.js";

describe("reportSlot", () => {
  it.each([
    // Winter (CET, UTC+1): 09:00 Brussels is 08:00 UTC.
    ["2026-01-14T12:00:00Z", "2026-01-12T08:00:00.000Z"],
    // Summer (CEST, UTC+2): 07:00 UTC.
    ["2026-07-15T12:00:00Z", "2026-07-13T07:00:00.000Z"],
    // Sunday 23:30 UTC is already Monday 01:30 in Brussels: that Monday's slot.
    ["2026-07-19T23:30:00Z", "2026-07-20T07:00:00.000Z"],
    // Week where DST starts (Sunday 29 March 2026): Monday before is still CET.
    ["2026-03-29T12:00:00Z", "2026-03-23T08:00:00.000Z"],
    ["2026-03-30T10:00:00Z", "2026-03-30T07:00:00.000Z"],
    // Week where DST ends (Sunday 25 October 2026): Monday before is still CEST.
    ["2026-10-25T12:00:00Z", "2026-10-19T07:00:00.000Z"],
    ["2026-10-26T10:00:00Z", "2026-10-26T08:00:00.000Z"],
  ])("%s -> %s", (now, slot) => {
    expect(reportSlot(new Date(now), "Europe/Brussels").toISOString()).toBe(slot);
  });

  it("follows the server's time zone", () => {
    expect(reportSlot(new Date("2026-10-14T12:00:00Z"), "UTC").toISOString()).toBe("2026-10-12T09:00:00.000Z");
    // Monday 09:00 in New York (EDT, UTC-4).
    expect(reportSlot(new Date("2026-10-14T12:00:00Z"), "America/New_York").toISOString()).toBe(
      "2026-10-12T13:00:00.000Z",
    );
  });
});

describe("dueReportWeek", () => {
  it.each([
    ["2026-10-19T06:59:59Z", null], // Monday 08:59:59 Brussels: not yet
    ["2026-10-19T07:00:00Z", "2026-10-12"], // 09:00 sharp
    ["2026-10-19T15:00:00Z", "2026-10-12"],
    ["2026-10-20T06:59:59Z", "2026-10-12"], // almost a day late, still posts
    ["2026-10-20T07:00:00Z", null], // a day late: skipped
    ["2026-10-24T12:00:00Z", null], // Saturday
    ["2026-10-26T08:00:00Z", "2026-10-19"], // after DST ends: 09:00 is 08:00 UTC
    ["2026-10-26T07:30:00Z", null], // 08:30 Brussels
    ["2027-01-04T08:00:00Z", "2026-12-28"], // across a year
  ])("%s -> %s", (now, week) => {
    expect(dueReportWeek(new Date(now), "Europe/Brussels")).toBe(week);
  });

  it("names the local week, not the UTC one", () => {
    // Monday 09:00 in Auckland (NZDT, UTC+13) is still Sunday in UTC.
    expect(dueReportWeek(new Date("2026-10-18T20:00:00Z"), "Pacific/Auckland")).toBe("2026-10-12");
  });
});

describe("addDays", () => {
  it("crosses months", () => expect(addDays("2026-10-26", 6)).toBe("2026-11-01"));
});

const full: ReportData = {
  top_talkers: [
    { display_name: "Alice", message_count: 1200 },
    { display_name: "Bob", message_count: 30 },
    { display_name: "Cleo", message_count: 1 },
  ],
  busiest_channel: { name: "general", message_count: 900 },
  top_emoji: { emoji_key: "123", emoji_id: "123", name: "pog", animated: true, reaction_count: 42 },
  joins: 5,
  leaves: 2,
};

describe("reportEmbed", () => {
  it("shows every stat", () => {
    const embed = reportEmbed("2026-10-12", full, "https://nihanbao.example", "Europe/Brussels");
    expect(embed.title).toBe("Weekly report card: week of 2026-10-12");
    expect(embed.url).toBe("https://nihanbao.example");
    expect(embed.footer?.text).toBe("Monday 2026-10-12 to Sunday 2026-10-18 (Europe/Brussels)");
    const [talkers, channel, emoji, growth] = embed.fields!.map((f) => f.value);
    expect(talkers).toBe("🥇 Alice: 1,200 messages\n🥈 Bob: 30 messages\n🥉 Cleo: 1 message");
    expect(channel).toBe("#general: 900 messages");
    expect(emoji).toBe("<a:pog:123> 42 times");
    expect(growth.split("\n")[0]).toBe("+3 (5 joined, 2 left)");
  });

  it("handles an empty week without a link", () => {
    const embed = reportEmbed(
      "2026-10-12",
      { top_talkers: [], busiest_channel: null, top_emoji: null, joins: 0, leaves: 1 },
      null,
      "UTC",
    );
    expect(embed.url).toBeUndefined();
    const [talkers, channel, emoji, growth] = embed.fields!.map((f) => f.value);
    expect(talkers).toMatch(/Nobody said a word/);
    expect(channel).toMatch(/Tumbleweeds/);
    expect(emoji).toMatch(/No reactions/);
    expect(growth.split("\n")[0]).toBe("-1 (0 joined, 1 left)");
  });

  it("shows a unicode emoji as itself", () => {
    const embed = reportEmbed(
      "2026-10-12",
      {
        ...full,
        top_emoji: { emoji_key: "😂", emoji_id: null, name: "😂", animated: false, reaction_count: 1 },
      },
      null,
      "UTC",
    );
    expect(embed.fields![2].value).toBe("😂 1 time");
  });
});

describe("isReportFor", () => {
  const empty: ReportData = { top_talkers: [], busiest_channel: null, top_emoji: null, joins: 0, leaves: 0 };
  it("finds the posted report card of that week only", () => {
    const embeds = [reportEmbed("2026-10-12", empty, null, "UTC")];
    expect(isReportFor(embeds, "2026-10-12")).toBe(true);
    expect(isReportFor(embeds, "2026-10-05")).toBe(false);
    expect(isReportFor([{ title: null }], "2026-10-12")).toBe(false);
  });
});

describe("postedSince", () => {
  const slot = Date.parse("2026-10-19T07:00:00Z");
  // Newest first, one per minute, like Discord history; message `i` is i minutes before the newest.
  const history = (count: number, newest: number) =>
    Array.from({ length: count }, (_, i) => ({ id: String(count - i), createdTimestamp: newest - i * 60_000 }));
  const pager = (messages: { id: string; createdTimestamp: number }[]) => {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (before: string | undefined) => {
      calls.push(before);
      const start = before === undefined ? 0 : messages.findIndex((m) => m.id === before) + 1;
      return messages.slice(start, start + PAGE_SIZE);
    };
    return { calls, fetchPage };
  };

  it("finds a report sent right after the slot behind more than 100 newer messages", async () => {
    const messages = history(250, slot + 249 * 60_000);
    const report = messages[249].id; // the oldest, posted at the slot
    const { calls, fetchPage } = pager(messages);
    expect(await postedSince(fetchPage, slot, (m) => m.id === report)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("stops paging once it is past the slot", async () => {
    const messages = history(500, slot + 150 * 60_000);
    const { calls, fetchPage } = pager(messages);
    expect(await postedSince(fetchPage, slot, () => false)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("ignores a match from before the slot, such as last week's report", async () => {
    const messages = history(10, slot + 60_000);
    const { fetchPage } = pager(messages);
    expect(await postedSince(fetchPage, slot, (m) => m.id === "1")).toBe(false);
  });

  it("fails closed when a page cannot be fetched", async () => {
    const messages = history(250, slot + 249 * 60_000);
    const { fetchPage } = pager(messages);
    let n = 0;
    const flaky = async (before: string | undefined) => {
      if (++n === 2) throw new Error("rate limited");
      return fetchPage(before);
    };
    await expect(postedSince(flaky, slot, () => false)).rejects.toThrow("rate limited");
  });
});
