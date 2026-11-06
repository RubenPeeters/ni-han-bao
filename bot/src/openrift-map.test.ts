import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMapping,
  lookup,
  mapFiles,
  mapPrintings,
  newListings,
  normaliseCode,
  notPlain,
  propose,
  unmappedReferences,
  type OldCatalogue,
  type OpenRiftCatalogue,
  type OpenRiftPrinting,
} from "./openrift-map.js";

const plain = (code: string, language: string, finish: string, extra: Partial<OpenRiftPrinting> = {}): OpenRiftPrinting => ({
  publicCode: code,
  cardId: "c1",
  finish,
  language,
  artVariant: "normal",
  isSigned: false,
  isOvernumbered: false,
  markers: [],
  distributionChannels: [],
  ...extra,
});

const old: OldCatalogue = {
  cards: [{ id: "annie", name: "Annie's Fire" }],
  printings: [
    { id: "rad-001-167", card_id: "annie", collector_code: "RAD-001/167" },
    { id: "ogn-279-298", card_id: "annie", collector_code: "OGN-279/298" },
  ],
};
const or: OpenRiftCatalogue = {
  cards: { c1: { slug: "annies-fire", name: "Annie’s Fire" } },
  printings: {
    "a-en-foil": plain("RAD-001/167-EN", "EN", "foil"),
    "a-sc-foil": plain("RAD-001/167-SC", "SC", "foil"),
    "a-en-promo": plain("RAD-001/167-EN", "EN", "foil", { markers: ["promo"] }),
    "a-en-signed": plain("RAD-001/167-EN", "EN", "normal", { isSigned: true }),
    "b-1": plain("OGN-279/298", "EN", "normal"),
    "b-2": plain("OGN-279/298", "EN", "normal"),
    "c-en": plain("SFD-R01", "EN", "metal", { artVariant: "altart", isOvernumbered: true, distributionChannels: [{ channel: "nexus-sfd" }] }),
    "kr": plain("RAD-001/167-KR", "KR", "foil"),
  },
};
const entries = mapPrintings(old, or);
const entry = (id: string, finish: string, language: string) => entries.find((e) => e.printing_id === id && e.finish === finish && e.language === language)!;

describe("normaliseCode", () => {
  it("removes only the printing's own language suffix", () => {
    expect(normaliseCode({ publicCode: "RAD-001/167-EN", language: "EN" })).toEqual({ code: "RAD-001/167", normalisation: "removed -EN" });
    expect(normaliseCode({ publicCode: "VEN-001/166-P-EN", language: "EN" }).code).toBe("VEN-001/166-P");
    expect(normaliseCode({ publicCode: "OGN-001/298", language: "SC" })).toEqual({ code: "OGN-001/298", normalisation: "none" });
    expect(normaliseCode({ publicCode: "RAD-001/167-FR", language: "EN" }).code).toBe("RAD-001/167-FR");
  });
});

describe("notPlain", () => {
  it("names markers, distribution channels and a signature", () => {
    expect(notPlain(plain("X", "EN", "foil"))).toEqual([]);
    expect(notPlain(plain("X", "EN", "foil", { markers: ["promo"], distributionChannels: [{ channel: "nexus-sfd" }], isSigned: true })))
      .toEqual(["marker: promo", "channel: nexus-sfd", "signed"]);
  });
});

describe("mapPrintings", () => {
  it("has every old printing × finish × language", () => {
    expect(entries).toHaveLength(2 * 2 * 3);
  });

  it("maps exactly one plain printing with the same code, finish and language", () => {
    expect(entry("rad-001-167", "foil", "en")).toMatchObject({ openrift_id: "a-en-foil", openrift_card_id: "c1", method: "exact", normalisation: "removed -EN" });
    expect(entry("rad-001-167", "foil", "zh-Hans")).toMatchObject({ openrift_id: "a-sc-foil" });
  });

  it("does not match a signed or promo printing, and says why", () => {
    expect(entry("rad-001-167", "normal", "en")).toMatchObject({ openrift_id: null, unmapped: "no plain printing in this finish" });
    expect(entry("rad-001-167", "foil", "fr")).toMatchObject({ openrift_id: null, unmapped: "code not in OpenRift in this language", candidates: [] });
  });

  it("leaves duplicates unmapped, with both candidates", () => {
    const e = entry("ogn-279-298", "normal", "en");
    expect(e).toMatchObject({ openrift_id: null, unmapped: "several plain printings" });
    expect("candidates" in e && e.candidates.map((c) => c.openrift_id)).toEqual(["b-1", "b-2"]);
  });
});

describe("propose", () => {
  it("takes EN normal where it exists, else the only finish", () => {
    const p = propose(entries);
    expect(p.find((x) => x.printing_id === "rad-001-167")).toMatchObject({ openrift_id: "a-en-foil", finish: "foil" });
    expect(p.find((x) => x.printing_id === "ogn-279-298")).toMatchObject({ openrift_id: null, finish: null });
  });
});

describe("newListings", () => {
  it("gives every unmapped printing its reasons from OpenRift's own fields, in the three languages only", () => {
    const listed = Object.fromEntries(newListings(old, or, entries).map((l) => [l.openrift_id, l.reasons]));
    expect(listed).toEqual({
      "a-en-promo": ["marker: promo"],
      "a-en-signed": ["signed"],
      "b-1": ["several plain printings with this code, finish and language"],
      "b-2": ["several plain printings with this code, finish and language"],
      "c-en": ["channel: nexus-sfd", "overnumbered", "artVariant: altart", "finish not in old catalogue", "code not in old catalogue"],
    });
  });
});

describe("buildMapping", () => {
  it("maps a card through its printings and lists a name that differs", () => {
    const m = buildMapping(old, or, { url: "u", fetched_at: "t", etag: null, build_id: null, sha256: "s" });
    expect(m.cards).toEqual([{ card_id: "annie", name: "Annie's Fire", openrift_card_id: "c1", openrift_slug: "annies-fire", openrift_name: "Annie’s Fire" }]);
    expect(m.conflicts).toEqual([{ kind: "names differ", cards: [{ card_id: "annie", name: "Annie's Fire" }], openrift: [{ openrift_card_id: "c1", openrift_name: "Annie’s Fire" }] }]);
  });

  it("does not map a card whose printings point at several OpenRift cards", () => {
    const split = structuredClone(or);
    split.cards.c2 = { slug: "other", name: "Other" };
    split.printings["a-sc-foil"].cardId = "c2";
    const m = buildMapping(old, split, { url: "u", fetched_at: "t", etag: null, build_id: null, sha256: "s" });
    expect(m.cards[0]).toMatchObject({ openrift_card_id: null, unmapped: "several OpenRift cards" });
    expect(m.conflicts.map((c) => c.kind)).toEqual(["several OpenRift cards"]);
  });
});

describe("unmappedReferences", () => {
  it("needs an exact or manual entry for a triple, the proposal for a bare printing, the card map for a card", () => {
    const m = buildMapping(old, or, { url: "u", fetched_at: "t", etag: null, build_id: null, sha256: "s" });
    const l = lookup({ printings: m.printings, proposed_without_finish_or_language: m.proposed }, { cards: m.cards }, [
      { printing_id: "ogn-279-298", finish: "normal", language: "en", openrift_id: "b-1", reason: "first print run" },
    ]);
    expect(unmappedReferences([
      { printing: "rad-001-167", finish: "foil", language: "en" },
      { printing: "ogn-279-298", finish: "normal", language: "en" },
      { printing: "rad-001-167", finish: "normal", language: "en" },
      { printing: "rad-001-167" },
      { printing: "ogn-279-298" },
      { card: "annie" },
      { card: "gone" },
    ], l)).toEqual([{ printing: "rad-001-167", finish: "normal", language: "en" }, { printing: "ogn-279-298" }, { card: "gone" }]);
  });
});

describe("the committed outputs", () => {
  it("are byte for byte what the committed snapshot gives", () => {
    const bot = new URL("../", import.meta.url);
    const read = (f: string) => readFileSync(new URL(f, bot), "utf8");
    const outputs = mapFiles(read("riftbound-cards.json"), readFileSync(new URL("openrift-catalog.json", bot)), read("openrift-catalog.manifest.json"), read("riftbound-cards.manifest.json"));
    for (const [path, text] of Object.entries(outputs)) expect(text === read(path), path).toBe(true);
  });
});
