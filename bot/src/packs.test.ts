import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Catalogue } from "./card-match.js";
import { isBasicPrinting, openPack, PACK_SETS, packWait, type PackPrinting } from "./packs.js";

// Riot's real catalogue, with each printing's card type as the site and the bot pass it.
const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const types = new Map(catalogue.cards.map((c) => [c.id, c.type]));
const printings: PackPrinting[] = catalogue.printings.map((p) => ({ ...p, type: types.get(p.card_id) ?? null }));

/** mulberry32: the same openings on every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("openPack", () => {
  it("opens 14 Origins cards in the slots of the layout", () => {
    const pack = openPack("OGN", printings, seeded(1))!;
    expect(pack).toHaveLength(14);
    const slots = pack.map((c) => c.slot);
    expect(slots.filter((s) => s === "Common")).toHaveLength(7);
    expect(slots.filter((s) => s === "Uncommon")).toHaveLength(3);
    expect(slots.filter((s) => s === "Rare or better")).toHaveLength(2);
    expect(pack.filter((c) => c.foil).map((c) => c.slot)).toEqual(["Foil"]);
    for (const c of pack) {
      expect(c.printing.set_code).toBe("OGN");
      if (c.slot === "Common") expect([c.printing.rarity, c.printing.type === "Rune"]).toEqual(["Common", false]);
      if (c.slot === "Uncommon") expect(c.printing.rarity).toBe("Uncommon");
      if (c.slot === "Rare or better") expect(["Rare", "Epic"]).toContain(c.printing.rarity);
      if (c.slot === "Token or rune") expect(c.printing.type).toBe("Rune");
    }
    // No card twice in a slot.
    expect(new Set(pack.filter((c) => c.slot === "Common").map((c) => c.printing.id)).size).toBe(7);
  });

  it("puts at least one Epic in 25 % ± 2 % of 10,000 packs, and never a printing that is not basic", () => {
    const rng = seeded(42);
    let withEpic = 0;
    let twoEpics = 0;
    for (let i = 0; i < 10_000; i++) {
      const pack = openPack("OGN", printings, rng)!;
      const epics = pack.filter((c) => c.slot === "Rare or better" && c.printing.rarity === "Epic").length;
      if (epics > 0) withEpic++;
      if (epics === 2) twoEpics++;
      for (const c of pack) expect(isBasicPrinting(c.printing.collector_code, c.printing.collector_number), c.printing.collector_code).toBe(true);
    }
    expect(withEpic / 10_000).toBeGreaterThanOrEqual(0.23);
    expect(withEpic / 10_000).toBeLessThanOrEqual(0.27);
    expect(twoEpics).toBeGreaterThan(0);
  });

  it("offers only sets with a layout: Origins, not Unleashed", () => {
    expect(PACK_SETS).toEqual(["OGN"]);
    expect(openPack("UNL", printings, seeded(1))).toBeNull();
  });

  it("leaves out a slot it has nothing for", () => {
    expect(openPack("OGN", [], seeded(1))).toEqual([]);
  });
});

describe("isBasicPrinting", () => {
  it("keeps a set's normal numbers, not alternate arts, overnumbers, signed, SP or tokens", () => {
    expect(isBasicPrinting("OGN-007/298", 7)).toBe(true);
    for (const [code, n] of [["OGN-007a/298", 7], ["OGN-299/298", 299], ["OGN-066*/298", 66], ["VEN-SP3/006", 3], ["SFD-T03", 3]] as const) {
      expect(isBasicPrinting(code, n), code).toBe(false);
    }
  });
});

describe("packWait", () => {
  it("waits out a minute per member", () => {
    expect(packWait(undefined, 5_000)).toBe(0);
    expect(packWait(0, 1)).toBe(60);
    expect(packWait(0, 59_001)).toBe(1);
    expect(packWait(0, 60_000)).toBe(0);
  });
});
