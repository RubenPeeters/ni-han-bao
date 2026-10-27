import assert from "node:assert/strict";
import { test } from "node:test";
import { championIcon, championIcons, championList, championMatches } from "./ddragon.ts";

const icons = championIcons("16.20.1", {
  LeeSin: { id: "LeeSin", name: "Lee Sin", image: { full: "LeeSin.png" } },
  MonkeyKing: { id: "MonkeyKing", name: "Wukong", image: { full: "MonkeyKing.png" } },
  Fiddlesticks: { id: "Fiddlesticks", name: "Fiddlesticks", image: { full: "Fiddlesticks.png" } },
});

test("names and ids both find the champion's Data Dragon icon", () => {
  const lee = "https://ddragon.leagueoflegends.com/cdn/16.20.1/img/champion/LeeSin.png";
  assert.equal(championIcon(icons, "Lee Sin"), lee);
  assert.equal(championIcon(icons, "LeeSin"), lee);
  assert.equal(championIcon(icons, "Wukong"), championIcon(icons, "MonkeyKing"));
  assert.match(championIcon(icons, "FiddleSticks"), /Fiddlesticks\.png$/);
});

test("an unknown champion has no icon", () => {
  assert.equal(championIcon(icons, "Nobody"), null);
});

test("the picker lists champions by name with their icons, and its search ignores case, accents and spaces", () => {
  const list = championList("16.20.1", {
    MonkeyKing: { id: "MonkeyKing", name: "Wukong", image: { full: "MonkeyKing.png" } },
    Ahri: { id: "Ahri", name: "Ahri", image: { full: "Ahri.png" } },
    KSante: { id: "KSante", name: "K'Santé", image: { full: "KSante.png" } },
  });
  assert.deepEqual(list.map((c) => c.id), ["Ahri", "KSante", "MonkeyKing"]);
  assert.equal(list[0].icon, "https://ddragon.leagueoflegends.com/cdn/16.20.1/img/champion/Ahri.png");
  assert.ok(championMatches(list[2], "wuk"));
  assert.ok(championMatches(list[2], "monkey king"));
  assert.ok(championMatches(list[1], "ksante"));
  assert.ok(!championMatches(list[0], "wukong"));
});
