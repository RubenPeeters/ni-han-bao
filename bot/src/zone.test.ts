import { describe, expect, it } from "vitest";
import { dayStart, localDay, timeZoneName, weekStart } from "./zone.js";

describe("timeZoneName", () => {
  it("canonicalizes a time zone in any case", () => {
    expect(timeZoneName("europe/brussels")).toBe("Europe/Brussels");
    expect(timeZoneName(" UTC ")).toBe("UTC");
  });
  it("rejects what is not a time zone", () => {
    expect(timeZoneName("Mars/Olympus_Mons")).toBeNull();
    expect(timeZoneName("")).toBeNull();
  });
});

describe("weekStart", () => {
  it.each([
    ["2026-10-17T10:00:00Z", "2026-10-12"], // Saturday
    ["2026-10-12T00:00:00Z", "2026-10-12"], // Monday
    ["2026-10-18T23:59:59Z", "2026-10-12"], // Sunday
    ["2026-11-01T12:00:00Z", "2026-10-26"], // across a month
  ])("UTC: %s -> %s", (now, monday) => {
    expect(weekStart(new Date(now), "UTC")).toBe(monday);
  });
  it("starts the week at local midnight", () => {
    // Sunday 23:30 UTC is Monday 01:30 in Brussels (summer time).
    expect(weekStart(new Date("2026-07-19T23:30:00Z"), "Europe/Brussels")).toBe("2026-07-20");
    expect(weekStart(new Date("2026-07-19T23:30:00Z"), "UTC")).toBe("2026-07-13");
  });
});

describe("localDay and dayStart", () => {
  it("use the local date", () => {
    expect(localDay(new Date("2026-10-18T23:30:00Z"), "Europe/Brussels")).toBe("2026-10-19");
    expect(localDay(new Date("2026-10-18T23:30:00Z"), "America/New_York")).toBe("2026-10-18");
  });
  it("find local midnight across DST", () => {
    expect(dayStart(new Date("2026-10-18T12:00:00Z"), "Europe/Brussels").toISOString()).toBe("2026-10-17T22:00:00.000Z");
    expect(dayStart(new Date("2026-10-26T12:00:00Z"), "Europe/Brussels").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(dayStart(new Date("2026-10-18T12:00:00Z"), "UTC").toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });
});
