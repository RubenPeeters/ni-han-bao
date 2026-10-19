import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardChoices,
  cardEmbed,
  cardMiss,
  catalogueJson,
  lookupCard,
  placeholderCatalogue,
  placeholderSvg,
  resolveCard,
  type Card,
  type Printing,
} from "./riftbound.js";

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
    card("u-zed", "Zed", "Unit"),
    card("l-zed", "Master of Shadows", "Legend", ["Zed"]),
  ];
  const printing = (card_id: string, collector_code: string): Printing => ({
    id: collector_code, card_id, collector_code, set_code: collector_code.split("-")[0], collector_number: 0,
    rarity: null, illustrator: null, image_url: null,
  });
  const printings = [
    printing("s-1", "OGN-001"),
    printing("u-ahri", "PLH-U103"),
    printing("s-2", "OGN-007a"),
    printing("s-3", "OGN-007b"),
    printing("u-zed", "SFD-232"),
    printing("u-zed", "SFD-232*"),
  ];
  const id = (typed: string) => {
    const r = resolveCard({ cards, printings }, typed);
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
    expect(id("kaisa")).toBe("l-kaisa");
    expect(id("Kaisa, Daughter of the Void")).toBe("l-kaisa");
  });

  it("reports a spelling that matches more than one card, and finds nothing for the rest", () => {
    expect(id("twin")).toEqual(["s-2", "s-3"]);
    expect(id("Twin Legend")).toBe("l-x");
    expect(id("zed")).toEqual(["u-zed", "l-zed"]);
    expect(id("Teemo")).toBeNull();
    expect(id("   ")).toBeNull();
  });

  it("finds a collector code without case, dashes or spaces", () => {
    for (const typed of ["OGN-001", "OGN001", "ogn-001", "OGN 001", " ogn - 001 "]) expect(id(typed)).toBe("s-1");
    expect(id("PLHU103")).toBe("u-ahri");
    expect(id("plh-u103")).toBe("u-ahri");
    expect(id("OGN-007a")).toBe("s-2");
    expect(id("OGN01")).toBeNull();
    expect(id("OGN")).toBeNull();
  });

  it("reports a code without its variant suffix as every card it could be", () => {
    expect(id("OGN-007")).toEqual(["s-2", "s-3"]);
    // Two printings of one card are still that card.
    expect(id("SFD232")).toBe("u-zed");
  });
});

describe("/card", () => {
  const { cards, printings } = placeholderCatalogue(champions);
  const legend = cards.find((c) => c.id === "placeholder-legend-ahri")!;
  const spell = cards.find((c) => c.name === "Quick Thought")!;
  const printed = (card: Card) => printings.filter((p) => p.card_id === card.id);

  it("suggests by name or champion, prefix matches first, at most 25, valued by id", () => {
    const ahri = cardChoices({ cards, printings }, "ahri");
    expect(ahri.map((c) => c.value)).toEqual(expect.arrayContaining(["placeholder-legend-ahri", "placeholder-unit-ahri"]));
    expect(ahri.find((c) => c.value === legend.id)!.name).toBe(`${legend.name} (Ahri legend)`);
    expect(cardChoices({ cards, printings }, "quick")[0]).toEqual({ name: "Quick Thought (Spell)", value: spell.id });
    expect(cardChoices({ cards, printings }, "").length).toBe(25);
    expect(cardChoices({ cards, printings }, "zzzz")).toEqual([]);
    expect(cardChoices({ cards, printings }, "plh u10")[0].value).toBe("placeholder-unit-ahri");
    expect(cardChoices({ cards, printings }, "PLH")).toEqual([]);
  });

  it("takes a picked id or a typed name", () => {
    expect(lookupCard({ cards, printings }, legend.id)).toEqual({ card: legend });
    expect(lookupCard({ cards, printings }, "quick thought")).toEqual({ card: spell });
    expect(lookupCard({ cards, printings }, "nothing like this")).toBeNull();
    expect(lookupCard({ cards, printings }, "PLHU103")).toEqual({ card: cards.find((c) => c.id === "placeholder-unit-ahri") });
  });

  it("shows the stats, the art when Discord can load it, and the placeholder label", () => {
    const embed = cardEmbed(legend, printed(legend), "https://site.test/");
    expect(embed.title).toBe(legend.name);
    expect(embed.url).toBe("https://site.test/cards/placeholder-legend-ahri");
    expect(embed.image?.url).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\//);
    expect(embed.fields?.map((f) => [f.name, f.value])).toEqual([
      ["Type", "Legend"],
      ["Cost", "-"],
      ["Might", "-"],
      ["Domains", legend.domains.join(", ")],
    ]);
    expect(embed.footer?.text).toBe("Placeholder card · PLH-L103");
    // The generated SVG is relative, and Discord shows no SVG anyway.
    expect(cardEmbed(spell, printed(spell), null)).toMatchObject({ url: undefined, image: undefined });
    expect(cardEmbed({ ...spell, placeholder: false }, [], null).footer).toBeUndefined();
  });

  it("explains a miss", () => {
    expect(cardMiss("Teemo", null)).toBe('No card called or numbered "Teemo". Pick one from the suggestions.');
    expect(cardMiss("twin", [spell])).toContain("Quick Thought (Spell)");
  });
});
