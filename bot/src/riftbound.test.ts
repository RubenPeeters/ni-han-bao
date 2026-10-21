import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardChoices,
  cardMiss,
  lookupCard,
  resolveCard,
  type Card,
  type Catalogue,
  type Printing,
} from "./riftbound.js";
import { plainText, textParts } from "./card-match.js";

// Riot's real cards (#206), as the feed gave them.
const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;

describe("card text tokens", () => {
  it("splits Riot's tokens from the words, each with its name", () => {
    expect(textParts("+1 :rb_might: and :rb_energy_2::rb_rune_fury:")).toEqual([
      "+1 ",
      { kind: "might", value: "might", label: "Might" },
      " and ",
      { kind: "energy", value: "2", label: "2 energy" },
      "",
      { kind: "rune", value: "fury", label: "Fury rune" },
      "",
    ]);
    expect(textParts(":rb_exhaust:")[1]).toEqual({ kind: "other", value: "exhaust", label: "Exhaust" });
  });
});

describe("plainText", () => {
  it("keeps Riot's words and lines, without the HTML", () => {
    expect(plainText("<p>[Empowered][&gt;] I have +1 :rb_might:.<br />Draw 1.</p><p>Then &quot;this&quot;.</p>")).toBe(
      '[Empowered][>] I have +1 :rb_might:.\nDraw 1.\nThen "this".',
    );
    expect(plainText("<p>Choose one —</p><ul><li>Ready 2 runes.</li><li>[Buff] a unit.</li></ul>")).toBe(
      "Choose one —\nReady 2 runes.\n[Buff] a unit.",
    );
  });
});

describe("resolveCard", () => {
  const card = (id: string, name: string, type: string, tags: string[] = []): Card => ({
    id, name, type, tags, supertypes: [], domains: [], energy: null, might: null, rules_text: null, placeholder: false,
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
    printing("u-ahri", "OGN-066/298"),
    printing("u-ahri", "OGN-066a/298"),
    printing("s-2", "OGN-007a"),
    printing("s-3", "OGN-007b"),
    printing("u-zed", "SFD-232"),
    printing("u-zed", "SFD-232*"),
    printing("s-1", "OGN-009"),
    printing("s-2", "OGN-009a"),
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
    expect(id("OGN066")).toBe("u-ahri");
    expect(id("ogn-066/298")).toBe("u-ahri");
    expect(id("OGN-06")).toBeNull();
    expect(id("OGN-007a")).toBe("s-2");
    expect(id("OGN01")).toBe("s-1");
    expect(id("OGN")).toBeNull();
  });

  it("reports a code without its variant suffix as every card it could be", () => {
    expect(id("OGN-007")).toEqual(["s-2", "s-3"]);
    // Two printings of one card are still that card.
    expect(id("SFD232")).toBe("u-zed");
    // The unsuffixed printing does not hide a variant that is another card.
    expect(id("OGN-009")).toEqual(["s-1", "s-2"]);
    expect(id("OGN-009a")).toBe("s-2");
  });
});

describe("/card", () => {
  const { cards, printings } = catalogue;
  const legend = cards.find((c) => c.id === "nine-tailed-fox")!;
  const unit = cards.find((c) => c.id === "ahri-alluring")!;

  it("suggests by name or champion, prefix matches first, at most 25, valued by id", () => {
    const ahri = cardChoices(catalogue, "ahri");
    expect(ahri.map((c) => c.value)).toEqual(expect.arrayContaining(["nine-tailed-fox", "ahri-alluring"]));
    expect(ahri.find((c) => c.value === legend.id)!.name).toBe("Nine-Tailed Fox (Ahri legend)");
    expect(cardChoices(catalogue, "ahri, all")[0]).toEqual({ name: "Ahri, Alluring (Unit)", value: unit.id });
    expect(cardChoices(catalogue, "").length).toBe(25);
    expect(cardChoices(catalogue, "zzzz")).toEqual([]);
    expect(cardChoices(catalogue, "ogn 255")[0].value).toBe(legend.id);
    expect(cardChoices(catalogue, "OGN")).toEqual([]);
  });

  it("lists every card a number finds, never picking one", () => {
    const sets = (typed: string) =>
      cardChoices(catalogue, typed).map((c) => printings.find((p) => p.card_id === c.value && /-0*34[a-z*]*\//.test(p.collector_code))?.set_code);
    expect(sets("34").length).toBeGreaterThan(3);
    expect(sets("34")[0]).toBe("OGN");
    expect(sets("ogn 34").every((s) => s === "OGN")).toBe(true);
  });

  it("takes a picked id, a typed name or a collector code", () => {
    expect(lookupCard(catalogue, legend.id)).toEqual({ card: legend });
    expect(lookupCard(catalogue, "ahri, alluring")).toEqual({ card: unit });
    expect(lookupCard(catalogue, "Ahri")).toEqual({ card: legend });
    expect(lookupCard(catalogue, "nothing like this")).toBeNull();
    expect(lookupCard(catalogue, "OGN-066")).toEqual({ card: unit });
  });

  it("explains a miss", () => {
    expect(cardMiss("Teemo", null)).toBe('No card called or numbered "Teemo". Pick one from the suggestions.');
    expect(cardMiss("twin", [unit])).toContain("Ahri, Alluring (Unit)");
  });
});
