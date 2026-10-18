import { describe, expect, it } from "vitest";
import { addMonths, dueRecapMonth, isRecapFor, lastMonth, recapMessage, recapSlot, recapUrls } from "./recap.js";

describe("addMonths", () => {
  it("crosses years both ways", () => {
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-03-31", 0)).toBe("2026-03-01");
  });
});

describe("dueRecapMonth", () => {
  it("is last month from 09:00 local on the 1st, for a day", () => {
    // 09:00 in Brussels on 1 November 2026 is 08:00 UTC (CET).
    expect(recapSlot(new Date("2026-11-01T12:00:00Z"), "Europe/Brussels").toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(dueRecapMonth(new Date("2026-11-01T07:59:00Z"), "Europe/Brussels")).toBeNull();
    expect(dueRecapMonth(new Date("2026-11-01T08:00:00Z"), "Europe/Brussels")).toBe("2026-10-01");
    expect(dueRecapMonth(new Date("2026-11-02T07:59:00Z"), "Europe/Brussels")).toBe("2026-10-01");
    expect(dueRecapMonth(new Date("2026-11-02T08:00:00Z"), "Europe/Brussels")).toBeNull();
  });

  it("uses the local month, not the UTC one", () => {
    // Still 31 December in New York.
    expect(dueRecapMonth(new Date("2027-01-01T03:00:00Z"), "America/New_York")).toBeNull();
    expect(dueRecapMonth(new Date("2027-01-01T14:00:00Z"), "America/New_York")).toBe("2026-12-01");
    expect(lastMonth(new Date("2027-01-01T03:00:00Z"), "America/New_York")).toBe("2026-11-01");
  });
});

describe("recap message", () => {
  it("links the page and attaches the card", () => {
    const urls = recapUrls("https://example.org/", "g1", "2026-09-01", "k");
    expect(urls).toEqual({
      page: "https://example.org/s/g1/recap/2026-09",
      image: "https://example.org/s/g1/recap/2026-09/og?key=k",
    });
    const msg = recapMessage("2026-09-01", Buffer.from("png"), urls.page);
    expect(msg.files[0].name).toBe("recap-2026-09.png");
    expect(msg.embeds[0].image?.url).toBe("attachment://recap-2026-09.png");
    expect(isRecapFor(msg.embeds, "2026-09-01")).toBe(true);
    expect(isRecapFor(msg.embeds, "2026-08-01")).toBe(false);
  });
});
