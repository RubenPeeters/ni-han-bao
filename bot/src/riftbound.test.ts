import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogueJson, placeholderCatalogue, placeholderSvg, resolveCard, type Card } from "./riftbound.js";

const champions = [
  { id: "Ahri", key: "103", name: "Ahri" },
  { id: "Kaisa", key: "145", name: "Kai'Sa" },
  { id: "Annie", key: "1", name: "Annie" },
];

describe("placeholderCatalogue", () => {
  const { cards, printings } = placeholderCatalogue(champions);

  it("makes a legend and a unit per champion, all marked as placeholders", () => {
    const ahri = cards.filter((c) => c.tags.includes("Ahri"));
    expect(ahri.map((c) => c.type)).toEqual(["Legend", "Unit"]);
    expect(ahri[0].name).not.toContain("Ahri");
    expect(ahri[1].name).toMatch(/^Ahri, /);
    expect(cards.every((c) => c.placeholder)).toBe(true);
    expect(cards.filter((c) => c.type === "Spell" || c.type === "Gear").length).toBeGreaterThan(24);
    expect(new Set(cards.map((c) => c.name.toLowerCase())).size).toBe(cards.length);
  });

  it("gives one printing per card, with Data Dragon art for champions and an svg for the rest", () => {
    expect(printings.map((p) => p.card_id)).toEqual(cards.map((c) => c.id));
    expect(printings.find((p) => p.card_id === "placeholder-unit-ahri")).toMatchObject({
      collector_code: "PLH-U103",
      collector_number: 103,
      image_url: "https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Ahri_0.jpg",
    });
    expect(printings.find((p) => p.card_id === "placeholder-spell-quick-thought")?.image_url).toBe(
      "/riftbound/placeholder-spell-quick-thought.svg",
    );
  });

  it("is byte-identical for the same champions in any order, and a new champion moves no id", () => {
    const again = placeholderCatalogue([...champions].reverse());
    expect(catalogueJson(again)).toBe(catalogueJson({ cards, printings }));
    const more = placeholderCatalogue([...champions, { id: "Zed", key: "238", name: "Zed" }]);
    const ids = (c: typeof more) => c.printings.map((p) => `${p.card_id} ${p.collector_code}`);
    expect(ids(more)).toEqual(expect.arrayContaining(ids({ cards, printings })));
  });

  it("matches the committed catalogue's format", () => {
    const committed = readFileSync(new URL("../riftbound-catalogue.json", import.meta.url), "utf8");
    expect(catalogueJson(JSON.parse(committed))).toBe(committed);
  });
});

describe("placeholderSvg", () => {
  it("shows the name and type, escaped", () => {
    const svg = placeholderSvg({ name: "Salt & <Pepper>", type: "Spell" });
    expect(svg).toContain("Salt &amp; &lt;Pepper&gt;");
    expect(svg).toContain(">Spell<");
    expect(svg).not.toMatch(/href|https?:\/\/(?!www\.w3\.org)/);
  });
});

describe("resolveCard", () => {
  const card = (id: string, name: string, type: string, tags: string[] = []): Card => ({
    id, name, type, tags, supertypes: [], domains: [], energy: null, might: null, rules_text: null, placeholder: true,
  });
  const cards = [
    card("l-ahri", "Nine Lives", "Legend", ["Ahri"]),
    card("u-ahri", "Ahri, Alluring", "Unit", ["Ahri"]),
    card("l-kaisa", "Daughter of the Void", "Legend", ["Kai'Sa"]),
    card("s-1", "Élan", "Spell"),
    card("s-2", "Twin", "Spell"),
    card("s-3", "Twin", "Gear"),
    card("l-x", "Twin Legend", "Legend", ["Twin Legend"]),
  ];
  const id = (typed: string) => {
    const r = resolveCard(cards, typed);
    return r && ("card" in r ? r.card.id : r.ambiguous.map((c) => c.id));
  };

  it("finds the exact name, without case, accents or extra spaces", () => {
    expect(id("ahri, alluring")).toBe("u-ahri");
    expect(id("  elan ")).toBe("s-1");
    expect(id("NINE   LIVES")).toBe("l-ahri");
  });

  it("finds a legend by its champion, alone or with the epithet", () => {
    expect(id("Ahri")).toBe("l-ahri");
    expect(id("Ahri, Nine Lives")).toBe("l-ahri");
    expect(id("kai’sa")).toBe("l-kaisa");
    expect(id("Kai'Sa, Daughter of the Void")).toBe("l-kaisa");
  });

  it("reports a spelling that matches more than one card, and finds nothing for the rest", () => {
    expect(id("twin")).toEqual(["s-2", "s-3"]);
    expect(id("Twin Legend")).toBe("l-x");
    expect(id("Teemo")).toBeNull();
    expect(id("   ")).toBeNull();
  });
});
