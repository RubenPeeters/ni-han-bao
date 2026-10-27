import assert from "node:assert/strict";
import { test } from "node:test";
import { championIcon, championIcons, championList } from "./ddragon.ts";

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

test("the champion list is by name, with Data Dragon's id", () => {
  assert.deepEqual(
    championList("16.20.1", {
      MonkeyKing: { id: "MonkeyKing", name: "Wukong", image: { full: "MonkeyKing.png" } },
      Ahri: { id: "Ahri", name: "Ahri", image: { full: "Ahri.png" } },
    }).map((c) => [c.id, c.name]),
    [["Ahri", "Ahri"], ["MonkeyKing", "Wukong"]],
  );
});
