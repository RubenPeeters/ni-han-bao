import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Catalogue } from "./card-match.js";
import { packMessage } from "./pack-reply.js";
import { openPack, PACK_DISCLAIMER } from "./packs.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const types = new Map(catalogue.cards.map((c) => [c.id, c.type]));
const printings = catalogue.printings.map((p) => ({ ...p, type: types.get(p.card_id) ?? null }));

describe("packMessage", () => {
  it("shows the 14 cards' images within Discord's 10 per gallery, the foil, and the disclaimer", () => {
    let n = 0;
    const pack = openPack("OGN", printings, () => (n = (n * 7 + 3) % 11) / 11)!;
    const message = packMessage("OGN", pack, catalogue.cards, "Anna");
    const json = JSON.stringify(message);
    const [container] = message.components as { components: { items?: unknown[]; content?: string }[] }[];
    const galleries = container.components.filter((c) => c.items).map((c) => c.items!.length);
    expect(galleries).toEqual([7, 7]);
    expect(container.components[0].content).toBe("### Anna opened a simulated Origins pack");
    expect(json).toContain(PACK_DISCLAIMER);
    expect(json).toContain("(foil)");
  });
});
