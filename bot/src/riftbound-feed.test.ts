import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildId, cardsJson, feedItems, manifest, slug, transformFeed } from "./riftbound-feed.js";

// Raw cards as Riot's gallery feed gave them on 2026-10-20.
const feed = JSON.parse(readFileSync(new URL("riftbound-feed.fixture.json", import.meta.url), "utf8"));
const items = feedItems(feed);
const catalogue = transformFeed(items);
const card = (id: string) => catalogue.cards.find((c) => c.id === id)!;
const printing = (id: string) => catalogue.printings.find((p) => p.id === id)!;
const raw = (code: string) => structuredClone(items.find((i) => (i as { publicCode: string }).publicCode === code)) as Record<string, unknown>;

describe("buildId", () => {
  it("reads it from the page and fails without one", () => {
    expect(buildId(`<script>{"props":{},"buildId":"ITtiC1BggwiAprwzqpkOt","isFallback":false}</script>`)).toBe("ITtiC1BggwiAprwzqpkOt");
    expect(() => buildId("<html></html>")).toThrow(/buildId/);
  });
});

describe("feedItems", () => {
  it("finds the card array by shape, wherever it is", () => {
    expect(items).toHaveLength(11);
    expect(feedItems({ a: [{ b: { cards: items } }] })).toBe(items);
  });

  it("fails when there is no card array, or more than one", () => {
    expect(() => feedItems({ items: [{ id: "x" }] })).toThrow(/found 0/);
    expect(() => feedItems({ a: items, b: items })).toThrow(/found 2/);
  });
});

describe("transformFeed", () => {
  it("makes a legend with its champion as a tag and Riot's labels", () => {
    expect(card("daughter-of-the-void")).toEqual({
      id: "daughter-of-the-void",
      name: "Daughter of the Void",
      type: "Legend",
      supertypes: [],
      domains: ["Fury", "Mind"],
      energy: null,
      might: null,
      tags: ["Kai'Sa"],
      rules_text:
        "<p>:rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. Use only to play spells. (Abilities that add resources can't be reacted to.)</p>",
      placeholder: false,
    });
  });

  it("makes one champion unit across its printings, named with its subtitle, from the newest set", () => {
    const ahri = card("ahri-inquisitive");
    expect(ahri).toMatchObject({ name: "Ahri, Inquisitive", type: "Unit", supertypes: ["Champion"], domains: ["Mind"], energy: 3, might: 3 });
    expect(catalogue.printings.filter((p) => p.card_id === "ahri-inquisitive").map((p) => p.collector_code)).toEqual([
      "OGN-119/298", "OGN-119a/298", "SFD-227/221", "SFD-227*/221", "VEN-SP3/006",
    ]);
    expect(printing("ogn-119a-298")).toMatchObject({ set_code: "OGN", collector_number: 119, rarity: "Showcase" });
  });

  it("keeps a promo code without a denominator, and a card without text", () => {
    expect(printing("ven-r04")).toMatchObject({
      card_id: "body-rune", set_code: "VEN", collector_code: "VEN-R04", collector_number: 4,
      rarity: "Common", illustrator: "Greg Ghielmetti & Leah Chen", rules_text: null, effect_text: null,
    });
    expect(printing("ven-r04").image_url).toMatch(/^https:\/\/cmsassets\.rgpub\.io\//);
    expect(card("body-rune")).toMatchObject({ type: "Rune", supertypes: ["Basic"], rules_text: null });
  });

  it("stores an empty type as null and lists the card", () => {
    expect(card("buff")).toMatchObject({ type: null, supertypes: ["Token"] });
    expect(catalogue.untyped).toEqual(["buff"]);
  });

  it("keeps a gear's effect apart from its text", () => {
    expect(printing("rad-150-167").effect_text).toBe("<p>[Ganking] (I can move from battlefield to battlefield.)</p>");
  });

  it("reports reprints with other wording, takes the newest text, and ignores reminder text", () => {
    expect(catalogue.textDifferences).toEqual([{ card_id: "sona-harmonious", printings: [["ogn-073-298"], ["ven-sp2-006"]] }]);
    expect(card("sona-harmonious").rules_text).toBe(printing("ven-sp2-006").rules_text);
  });

  it("is sorted and byte-identical for the same feed", () => {
    expect(catalogue.cards.map((c) => c.id)).toEqual(catalogue.cards.map((c) => c.id).sort());
    expect(catalogue.printings.map((p) => p.id)).toEqual(catalogue.printings.map((p) => p.id).sort());
    expect(cardsJson(transformFeed([...items].reverse()))).toBe(cardsJson(catalogue));
  });

  it("collects Riot's icon per facet value and per glyph, with the domain colours", () => {
    expect(catalogue.icons.find((i) => i.facet === "domain" && i.value === "fury")).toEqual({
      facet: "domain",
      value: "fury",
      label: "Fury",
      icon_url: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5aeb4bfd203b5d265902f65aa5afae7da1682eaa-64x64.png?accountingTag=RB",
      color_primary: "#1A0D0E",
      color_secondary: "#F9DCDE",
    });
    expect(catalogue.icons.filter((i) => i.facet === "glyph").map((i) => [i.value, i.icon_url.split("/").pop()])).toEqual([
      ["illustrator", "artist.svg"], ["might", "might.svg"], ["mightBonus", "might.svg"], ["power", "card_type_rune.svg"],
    ]);
    expect(catalogue.icons.find((i) => i.facet === "supertype")).toMatchObject({ value: "champion", label: "Champion", color_primary: null });
    // Supertypes without an icon (Basic, Signature, Token) have no row.
    expect(catalogue.icons.map((i) => `${i.facet}:${i.value}`)).not.toContain("supertype:basic");
  });

  it("takes icons only from Riot's CDN, and one icon per value", () => {
    const elsewhere = raw("VEN-R04");
    (elsewhere.domain as { values: { icon: { url: string } }[] }).values[0].icon.url = "https://example.com/body.png";
    expect(() => transformFeed([elsewhere])).toThrow(/VEN-R04: unexpected domain icon url/);
    const other = raw("OGN-119/298");
    (other.domain as { values: { icon: { url: string } }[] }).values[0].icon.url = "https://cmsassets.rgpub.io/other.png";
    expect(() => transformFeed([raw("OGN-119a/298"), other])).toThrow(/icon domain:mind differs/);
  });

  it("fails on a set missing from the release order", () => {
    const next = raw("VEN-R04");
    next.set = { value: { id: "LEG", label: "Legacy" } };
    expect(() => transformFeed([next])).toThrow(/LEG is not in SET_ORDER/);
  });

  it("fails on a set the feed names differently", () => {
    const renamed = raw("VEN-R04");
    renamed.set = { value: { id: "VEN", label: "Vendettas" } };
    expect(() => transformFeed([renamed])).toThrow(/VEN-R04: unexpected set VEN label/);
  });

  it("fails on a changed shape, never guessing", () => {
    const changed = raw("VEN-R04");
    changed.rarity = "Common";
    expect(() => transformFeed([changed])).toThrow(/VEN-R04: unexpected rarity/);
  });

  it("fails when one id would merge two different names, or a printing repeats", () => {
    const other = raw("VEN-R04");
    other.id = "x";
    other.name = "Body-Rune";
    expect(() => transformFeed([raw("VEN-R04"), other])).toThrow(/body-rune is shared/);
    expect(() => transformFeed([raw("VEN-R04"), raw("VEN-R04")])).toThrow(/repeats printing ids: ven-r04/);
  });
});

describe("slug", () => {
  it("drops accents and apostrophes", () => {
    expect(slug("Kai'Sa Survivor")).toBe("kaisa-survivor");
    expect(slug("Jarvan IV Royal Heir")).toBe("jarvan-iv-royal-heir");
  });
});

describe("manifest", () => {
  it("counts per set and hashes the card file", () => {
    const json = cardsJson(catalogue);
    const m = JSON.parse(manifest(catalogue, json, { url: "https://example/feed.json", buildId: "b", fetchedAt: new Date(0) }));
    expect(m).toMatchObject({
      build_id: "b",
      fetched_at: "1970-01-01T00:00:00.000Z",
      printings_per_set: { OGN: 4, OGS: 0, SFD: 2, UNL: 1, VEN: 3, RAD: 1 },
      untyped: ["buff"],
    });
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bot/riftbound-cards.json", () => {
  it("is in the committed format and matches its manifest", () => {
    const committed = readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8");
    const m = JSON.parse(readFileSync(new URL("../riftbound-cards.manifest.json", import.meta.url), "utf8"));
    expect(cardsJson({ ...JSON.parse(committed), untyped: [], textDifferences: [] })).toBe(committed);
    expect(createHash("sha256").update(committed).digest("hex")).toBe(m.sha256);
  });

  it("is the catalogue supabase/seed.sql loads into the dev database", () => {
    const committed = readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8");
    const seed = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
    expect(seed).toContain(`select private.load_riftbound_catalogue($catalogue$\n${committed}$catalogue$::jsonb);\n`);
  });
});
