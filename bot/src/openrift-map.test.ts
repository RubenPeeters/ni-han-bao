import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, referencesSql } from "./map-check-lib.js";
import { buildMaps, derive, isPlain, normaliseCode, UNMAPPED, validateManual, type OpenRiftCatalog, type OpenRiftPrinting } from "./openrift-map.js";

const printing = (over: Partial<OpenRiftPrinting>): OpenRiftPrinting => ({
  publicCode: "OGN-001/298", cardId: "c1", finish: "normal", language: "EN", artVariant: "normal",
  isSigned: false, isOvernumbered: false, markers: [], distributionChannels: [], ...over,
});

const riot = {
  cards: [{ id: "annie", name: "Annie's Spark" }, { id: "gone", name: "Gone" }],
  printings: [
    { id: "ogn-001-298", card_id: "annie", collector_code: "OGN-001/298" },
    { id: "ogn-002-298", card_id: "gone", collector_code: "OGN-002/298" },
  ],
};

const catalog: OpenRiftCatalog = {
  cards: { c1: { slug: "annie-s-spark", name: "Annie’s Spark" }, c2: { slug: "other", name: "Other" } },
  printings: {
    "p-en-n": printing({ publicCode: "OGN-001/298-EN" }),
    "p-en-f": printing({ finish: "foil" }),
    "p-en-promo": printing({ finish: "foil", markers: ["promo"], publicCode: "OGN-001/298-P-EN" }),
    "p-sc-n1": printing({ language: "SC" }),
    "p-sc-n2": printing({ language: "SC" }),
    "p-fr-signed": printing({ language: "FR", isSigned: true, artVariant: "altart" }),
    "p-kr": printing({ language: "KR" }),
    "p-new": printing({ publicCode: "SFD-R01", cardId: "c2", finish: "metal", distributionChannels: [{ channel: "nexus-sfd" }] }),
  },
};

describe("matching", () => {
  it("removes only the printing's own language suffix", () => {
    expect(normaliseCode("RAD-001/167-EN", "EN")).toBe("RAD-001/167");
    expect(normaliseCode("OGN-279/298", "EN")).toBe("OGN-279/298");
    expect(normaliseCode("VEN-001/166-SC", "EN")).toBe("VEN-001/166-SC");
    expect(normaliseCode("VEN-R06b-EN-P", "EN")).toBe("VEN-R06b-EN-P");
  });

  it("calls a printing plain only without markers, channels or a signature", () => {
    expect(isPlain(printing({}))).toBe(true);
    expect(isPlain(printing({ markers: ["promo"] }))).toBe(false);
    expect(isPlain(printing({ distributionChannels: [{ channel: "x" }] }))).toBe(false);
    expect(isPlain(printing({ isSigned: true }))).toBe(false);
    expect(isPlain(printing({ artVariant: "altart", isOvernumbered: true }))).toBe(true);
  });

  const maps = buildMaps(riot, catalog, []);
  const entry = (old: string, finish: string, language: string) =>
    maps.printings.find((e) => e.old === old && e.finish === finish && e.language === language)!;

  it("maps one plain printing per code, finish and language, and reports the rest", () => {
    expect(maps.printings).toHaveLength(12);
    expect(entry("ogn-001-298", "normal", "en")).toEqual({ old: "ogn-001-298", finish: "normal", language: "en", openrift: "p-en-n", method: "exact" });
    expect(entry("ogn-001-298", "foil", "en")).toMatchObject({ openrift: "p-en-f", method: "exact" });
    expect(entry("ogn-001-298", "normal", "zh-Hans")).toMatchObject({ openrift: null, reason: UNMAPPED.several, candidates: ["p-sc-n1", "p-sc-n2"] });
    expect(entry("ogn-001-298", "foil", "zh-Hans")).toMatchObject({ openrift: null, reason: UNMAPPED.noPlain, candidates: ["p-sc-n1", "p-sc-n2"] });
    expect(entry("ogn-001-298", "normal", "fr")).toMatchObject({ openrift: null, reason: UNMAPPED.noPlain, candidates: ["p-fr-signed"] });
    expect(entry("ogn-002-298", "normal", "en")).toMatchObject({ openrift: null, reason: UNMAPPED.noCode, candidates: [] });
  });

  it("derives cards through printings and keeps both names", () => {
    expect(maps.cards).toEqual([
      { old: "annie", name: "Annie's Spark", openrift: "c1", slug: "annie-s-spark", openrift_name: "Annie’s Spark" },
      { old: "gone", name: "Gone", openrift: null, reason: "no mapped printing", candidates: [] },
    ]);
  });

  it("proposes EN normal, else EN foil, for rows without finish or language", () => {
    expect(maps.proposed).toEqual([
      { old: "ogn-001-298", proposed: "p-en-n", finish: "normal", candidates: ["p-en-n", "p-en-f"] },
      { old: "ogn-002-298", proposed: null, finish: null, candidates: [] },
    ]);
  });

  it("gives every new listing its reasons from OpenRift's fields, and leaves out other languages", () => {
    expect(maps.newListings).toEqual([
      { id: "p-en-promo", reasons: ["marker: promo", "code not in old catalogue"] },
      { id: "p-fr-signed", reasons: ["signed", "art variant: altart"] },
      { id: "p-new", reasons: ["channel: nexus-sfd", "finish not in old catalogue", "code not in old catalogue"] },
      { id: "p-sc-n1", reasons: ["one of several plain printings"] },
      { id: "p-sc-n2", reasons: ["one of several plain printings"] },
    ]);
  });

  it("applies manual entries only to unmapped combinations", () => {
    const manual = (openrift: string, finish = "normal") => validateManual({ entries: [{ old: "ogn-001-298", finish, language: "zh-Hans", openrift, reason: "same art" }] });
    const withManual = buildMaps(riot, catalog, manual("p-sc-n1"));
    expect(withManual.printings.find((e) => e.language === "zh-Hans" && e.finish === "normal" && e.old === "ogn-001-298"))
      .toMatchObject({ openrift: "p-sc-n1", method: "manual", reason: "same art" });
    expect(withManual.newListings.map((n) => n.id)).not.toContain("p-sc-n1");
    expect(() => buildMaps(riot, catalog, manual("nope"))).toThrow(/not an OpenRift printing/);
    expect(() => validateManual({ entries: [{ old: "x", finish: "metal", language: "en", openrift: "p", reason: "r" }] })).toThrow(/bad entry/);
  });
});

describe("map check", () => {
  const maps = {
    printing: {
      printings: [{ old: "a", finish: "normal", language: "en", openrift: "x" }, { old: "a", finish: "foil", language: "en", openrift: null }],
      without_finish_or_language: [{ old: "a", proposed: "x" }, { old: "b", proposed: null }],
    },
    card: { cards: [{ old: "annie", openrift: "c1" }, { old: "gone", openrift: null }] },
  };

  it("checks each kind of reference against its map", () => {
    const fk = { table: "riftbound_collection", column: "printing_id", target: "riftbound_printings", finish_and_language: true } as const;
    expect(checkReferences(fk, [["a", "normal", "en"], ["a", "foil", "en"], ["z", "foil", "en"]], maps).unmapped)
      .toEqual(["a foil en", "z foil en (not in the map)"]);
    expect(checkReferences({ ...fk, finish_and_language: false }, ["a", "b"], maps).unmapped).toEqual(["b"]);
    expect(checkReferences({ ...fk, target: "riftbound_cards", column: "card_id" }, ["annie", "gone"], maps).unmapped).toEqual(["gone"]);
    expect(referencesSql(fk)).toBe(`select coalesce(json_agg(distinct jsonb_build_array("printing_id", finish, language::text)), '[]') from riftbound_collection where "printing_id" is not null`);
  });
});

describe("committed outputs", () => {
  it("are byte-for-byte what the committed snapshot gives", () => {
    const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const out = derive(JSON.parse(read("riftbound-cards.json")), JSON.parse(read("openrift-catalog.json")),
      JSON.parse(read("openrift-catalog.meta.json")), JSON.parse(read("riftbound-printing-map.manual.json")));
    expect(out.printingMap === read("riftbound-printing-map.json")).toBe(true);
    expect(out.cardMap === read("riftbound-card-map.json")).toBe(true);
    expect(out.report === read("../docs/openrift-mapping.md")).toBe(true);
  });
});
