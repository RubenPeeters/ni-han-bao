import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { altType, findingText, printingFindings, staleFindings, symbolCrop, symbolDomain } from "./riftbound-checks.js";
import { feedItems, transformFeed } from "./riftbound-feed.js";

const items = feedItems(JSON.parse(readFileSync(new URL("riftbound-feed.fixture.json", import.meta.url), "utf8")));
const catalogue = transformFeed(items);
const card = (id: string) => catalogue.cards.find((c) => c.id === id)!;
const printing = (id: string) => catalogue.printings.find((p) => p.id === id)!;
const raw = (code: string) => structuredClone(items.find((i) => (i as { publicCode: string }).publicCode === code)) as Record<string, unknown>;
const types = new Set(["Unit", "Spell", "Gear", "Legend", "Battlefield", "Rune"]);
const blade = printing("rad-150-167");
const image = blade.image_url!;

describe("altType", () => {
  it("reads the type, none for a token, and nothing outside the pattern", () => {
    expect(altType("Riftbound Gear: Blade of the Exile. [Equip] — [A].", types)).toBe("Gear");
    expect(altType("Riftbound : Buff. A unit may have no more than one buff at a time.", types)).toBeNull();
    expect(altType("Riftbound None: XP Tracker. Track gained XP here.", types)).toBeNull();
    expect(altType("Riftbound Unit, Gear: Patched Porobot. (I enter exhausted.)", types)).toBeUndefined();
    expect(altType("Riftbound Gears: Blade of the Exile.", types)).toBeUndefined();
    expect(altType("Blade of the Exile", types)).toBeUndefined();
    expect(altType(null, types)).toBeUndefined();
  });
});

describe("printingFindings", () => {
  it("finds nothing when the alt text agrees and nothing is missing", () => {
    expect(printingFindings(card("blade-of-the-exile"), blade, "Riftbound Gear: Blade of the Exile.", types)).toEqual([]);
    expect(catalogue.findings).toEqual([]);
  });

  it("reports a type the alt text contradicts, gives, or does not state", () => {
    const at = { check: "type", printing: "RAD-150/167", image_url: image };
    expect(printingFindings({ ...card("blade-of-the-exile"), type: "Unit" }, blade, "Riftbound Gear: Blade.", types))
      .toEqual([{ ...at, feed: "Unit", other: "alt text Gear" }]);
    expect(printingFindings({ ...card("blade-of-the-exile"), type: "Gear" }, blade, "Riftbound Unit, Gear: Blade.", types))
      .toEqual([{ ...at, feed: "Gear", other: 'alt text "Riftbound Unit, Gear: Blade." not understood' }]);
  });

  it("reports a missing type or domain, unless the card is a token", () => {
    const untyped = { ...card("blade-of-the-exile"), type: null, domains: [] };
    expect(printingFindings(untyped, blade, "Riftbound Gear: Blade.", types).map((f) => [f.check, f.feed, f.other])).toEqual([
      ["type", "no type", "alt text Gear"],
      ["missing", "no type", null],
      ["missing", "no domain", null],
    ]);
    expect(printingFindings({ ...card("buff"), domains: [] }, printing("unl-t04"), "Riftbound : Buff.", types)).toEqual([]);
  });

  it("is run by transformFeed on every printing, after corrections", () => {
    const wrong = raw("RAD-150/167");
    (wrong.cardType as { type: unknown[] }).type = [];
    (wrong.domain as { values: unknown[] }).values = [];
    const reported = transformFeed(items.map((i) => ((i as { publicCode: string }).publicCode === "RAD-150/167" ? wrong : i)));
    expect(reported.findings.map((f) => `${f.check}: ${f.feed}`)).toEqual(["missing: no domain", "missing: no type", "type: no type"]);
    const corrected = transformFeed(items, { "blade-of-the-exile": { printing: "RAD-150/167", type: "Unit", source: ["image alt text"] } });
    expect(corrected.findings).toEqual([{ check: "type", printing: "RAD-150/167", feed: "Unit", other: "alt text Gear", image_url: image }]);
  });
});

describe("staleFindings", () => {
  const feed = card("blade-of-the-exile");

  it("reports what of a correction the feed now agrees with", () => {
    const at = { check: "stale correction", printing: "RAD-150/167", image_url: image };
    expect(staleFindings(feed, { printing: "RAD-150/167", type: "Gear", domains: ["Fury"], source: [] }, image))
      .toEqual([{ ...at, feed: "Gear", other: "correction Gear" }]);
    expect(staleFindings(feed, { printing: "RAD-150/167", type: "Unit", domains: ["Calm", "Chaos"], source: [] }, image))
      .toEqual([{ ...at, feed: "Calm, Chaos", other: "correction Calm, Chaos" }]);
    expect(staleFindings(feed, { printing: "RAD-150/167", type: "Unit", domains: ["Calm"], source: [] }, image)).toEqual([]);
  });

  it("is run by transformFeed on the feed before the correction", () => {
    const stale = transformFeed(items, { "blade-of-the-exile": { printing: "RAD-150/167", type: "Gear", source: ["image alt text"] } });
    expect(stale.findings).toEqual([{ check: "stale correction", printing: "RAD-150/167", feed: "Gear", other: "correction Gear", image_url: image }]);
  });
});

describe("symbolDomain", () => {
  // Corners of Riot's images as symbolCrop cuts them, from 2026-10-29.
  const crop = async (name: string) => {
    const { data, info } = await sharp(readFileSync(new URL(`symbol-fixtures/${name}.png`, import.meta.url)))
      .raw().toBuffer({ resolveWithObject: true });
    return symbolDomain({ data, width: info.width, height: info.height, channels: info.channels });
  };

  it("reads the domain from the symbol's colour, also on full-art cards", async () => {
    expect(await crop("fury")).toBe("Fury"); // RAD-001/167, which the feed calls Chaos
    expect(await crop("body-rune")).toBe("Body"); // VEN-R04
    expect(await crop("mind-full-art")).toBe("Mind"); // OGN-119/298
    expect(await crop("calm-full-art")).toBe("Calm"); // RAD-046/167, Resplendent Rostrum
  });

  it("reads nothing from a dimmed symbol rather than guess", async () => {
    expect(await crop("dimmed")).toBeNull(); // SFD-020/221
  });

  it("finds the symbol in the bottom-right corner of a whole card", async () => {
    const circle = (fill: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="744" height="1039"><circle cx="693" cy="1000" r="14" fill="${fill}"/></svg>`);
    const card = (fill: string) =>
      sharp({ create: { width: 744, height: 1039, channels: 3, background: "#000" } }).composite([{ input: circle(fill) }]).png().toBuffer();
    expect(symbolDomain(await symbolCrop(await card("#2a72b5")))).toBe("Mind");
    expect(symbolDomain(await symbolCrop(await card("#7a2fb0")))).toBe("Chaos");
    expect(symbolDomain(await symbolCrop(await card("#808080")))).toBeNull();
  });
});

describe("findingText", () => {
  it("names the printing, both values and the image", () => {
    expect(findingText({ check: "domain symbol", printing: "RAD-001/167", feed: "Chaos", other: "card image Fury", image_url: "https://x/1.png" }))
      .toBe("RAD-001/167 domain symbol: feed Chaos, card image Fury (https://x/1.png)");
    expect(findingText({ check: "missing", printing: "RAD-009/167", feed: "no domain", other: null, image_url: "https://x/9.png" }))
      .toBe("RAD-009/167 missing: feed no domain (https://x/9.png)");
  });
});
