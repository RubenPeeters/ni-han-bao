import { describe, expect, it } from "vitest";
import { championChoices, findChampion, parseChampions } from "./champions.js";

const champions = parseChampions({
  Ahri: { id: "Ahri", name: "Ahri" },
  MonkeyKing: { id: "MonkeyKing", name: "Wukong" },
  LeeSin: { id: "LeeSin", name: "Lee Sin" },
  KSante: { id: "KSante", name: "K'Santé" },
  Kaisa: { id: "Kaisa", name: "Kai'Sa" },
});

describe("findChampion", () => {
  it.each([
    ["wukong", "MonkeyKing"],
    ["MonkeyKing", "MonkeyKing"],
    ["  lee sin ", "LeeSin"],
    ["LEESIN", "LeeSin"],
    ["ksante", "KSante"],
    ["K'Santé", "KSante"],
    ["kai sa", "Kaisa"],
  ])("%s is %s", (typed, id) => {
    expect(findChampion(champions, typed)?.id).toBe(id);
  });

  it("finds nothing for part of a name, an unknown name or nothing", () => {
    expect(findChampion(champions, "wu")).toBeNull();
    expect(findChampion(champions, "Teemo")).toBeNull();
    expect(findChampion(champions, " ' ")).toBeNull();
  });
});

describe("championChoices", () => {
  it("offers names starting with the text first, an id as the value", () => {
    expect(championChoices(champions, "k")).toEqual([
      { name: "K'Santé", value: "KSante" },
      { name: "Kai'Sa", value: "Kaisa" },
      { name: "Wukong", value: "MonkeyKing" },
    ]);
  });

  it("matches the id too, and offers at most 25", () => {
    expect(championChoices(champions, "monkey")).toEqual([{ name: "Wukong", value: "MonkeyKing" }]);
    const many = parseChampions(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`C${i}`, { id: `C${i}`, name: `C${i}` }])));
    expect(championChoices(many, "")).toHaveLength(25);
  });
});
