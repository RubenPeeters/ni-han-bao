import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCards, matchesCode, resolveCard, type Catalogue } from "./card-match.js";

// Riot's real cards (#206), as the feed gave them.
const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const codes = (typed: string) => catalogue.printings.filter((p) => matchesCode(typed, p.collector_code)).map((p) => p.collector_code);

describe("matchesCode", () => {
  it("finds a number in every set, with every variant, leading zeros or not", () => {
    for (const typed of ["34", "034", "0034"]) {
      expect(codes(typed)).toEqual(expect.arrayContaining(["OGN-034/298", "SFD-034/221"]));
      expect(codes(typed).every((c) => /^[A-Z]+-034[a-z*]*\/\d+$/.test(c))).toBe(true);
    }
    expect(matchesCode("34", "OGN-034a/298")).toBe(true);
    expect(matchesCode("34", "SFD-034*/221")).toBe(true);
  });

  it("is not a substring search", () => {
    for (const code of ["OGN-134/298", "OGN-340/298", "OGN-003/298"]) expect(matchesCode("34", code)).toBe(false);
    expect(matchesCode("ogn", "OGN-034/298")).toBe(false);
    expect(matchesCode("ahri", "OGN-034/298")).toBe(false);
  });

  it("narrows to a variant", () => {
    expect(matchesCode("34a", "OGN-034a/298")).toBe(true);
    expect(matchesCode("34a", "OGN-034/298")).toBe(false);
    expect(matchesCode("34*", "SFD-034*/221")).toBe(true);
    expect(matchesCode("34*", "SFD-034/221")).toBe(false);
  });

  it("narrows to a set, typed any way", () => {
    for (const typed of ["ogn 34", "OGN-34", "ogn34", "ogn-034"]) {
      expect(matchesCode(typed, "OGN-034/298")).toBe(true);
      expect(matchesCode(typed, "OGN-034a/298")).toBe(true);
      expect(matchesCode(typed, "SFD-034/221")).toBe(false);
    }
  });

  it("takes Riot's prefixed numbers as printed", () => {
    for (const typed of ["r4", "R04"]) expect(codes(typed)).toEqual(expect.arrayContaining(["VEN-R04", "RAD-R04", "RAD-R04a"]));
    expect(codes("t3")).toContain("SFD-T03");
    expect(codes("sp3")).toContain("VEN-SP3/006");
    expect(matchesCode("rad r4", "VEN-R04")).toBe(false);
    expect(matchesCode("4", "VEN-R04")).toBe(false);
    expect(matchesCode("r4", "OGN-004/298")).toBe(false);
  });

  it("keeps full codes, with or without the set's size", () => {
    expect(matchesCode("OGN-007a/298", "OGN-007a/298")).toBe(true);
    expect(matchesCode("OGN-007a", "OGN-007a/298")).toBe(true);
    expect(matchesCode("OGN-007/298", "OGN-007b/298")).toBe(true);
    expect(matchesCode("OGN-007a/221", "OGN-007a/298")).toBe(false);
  });
});

describe("findCards", () => {
  it("lists every card a number finds, in set order then number", () => {
    const found = findCards(catalogue, "34");
    const sets = found.map((c) => catalogue.printings.find((p) => p.card_id === c.id && matchesCode("34", p.collector_code))!.set_code);
    expect(sets.length).toBeGreaterThan(3);
    expect(sets).toEqual(sets.toSorted((a, b) => ["OGN", "OGS", "SFD", "UNL", "VEN", "RAD"].indexOf(a) - ["OGN", "OGS", "SFD", "UNL", "VEN", "RAD"].indexOf(b)));
  });

  it("still finds names and champions, and nothing for nothing", () => {
    expect(findCards(catalogue, "ahri").map((c) => c.id)).toEqual(expect.arrayContaining(["nine-tailed-fox", "ahri-alluring"]));
    expect(findCards(catalogue, "  ")).toEqual([]);
  });
});

describe("resolveCard by number", () => {
  it("never picks one of several cards a number finds", () => {
    const r = resolveCard(catalogue, "34");
    expect(r && "ambiguous" in r && r.ambiguous.length).toBe(findCards(catalogue, "34").length);
  });
});
