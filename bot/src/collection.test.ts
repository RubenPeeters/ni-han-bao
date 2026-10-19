import { describe, expect, it, vi } from "vitest";
import { addToCollection, COLLECTION_COMMAND, setLending, type CollectionWriter } from "./collection.js";
import type { Catalogue } from "./riftbound.js";

const card = { name: "Ahri", type: "Unit", supertypes: [], domains: [], energy: 2, might: 2, tags: [], rules_text: null, placeholder: true };
const printing = { set_code: "PLH", rarity: null, illustrator: null, image_url: null };
const catalogue: Catalogue = {
  cards: [{ ...card, id: "ahri" }],
  printings: [
    { ...printing, id: "PLH-U103b", card_id: "ahri", collector_code: "PLH-U103b", collector_number: 103 },
    { ...printing, id: "PLH-U103", card_id: "ahri", collector_code: "PLH-U103", collector_number: 103 },
  ],
};

const writer = (over: Partial<CollectionWriter> = {}): CollectionWriter => ({
  add: vi.fn(async () => 3),
  lendDefault: vi.fn(async () => null),
  setLending: vi.fn(async () => true),
  ...over,
});

describe("COLLECTION_COMMAND", () => {
  it("keeps choice names within Discord's 100 characters", () => {
    for (const sub of COLLECTION_COMMAND.options)
      for (const o of sub.options) for (const c of "choices" in o ? o.choices : []) expect(c.name.length).toBeLessThanOrEqual(100);
  });
});

describe("addToCollection", () => {
  it("adds to the card's first printing and says the new count", async () => {
    const w = writer();
    expect(await addToCollection(w, catalogue, "u", "ahri", 2)).toBe("Added 2 × Ahri (PLH-U103). You now have 3.");
    expect(w.add).toHaveBeenCalledWith("u", "PLH-U103", 2);
  });

  it("writes nothing for a name that is not a card", async () => {
    const w = writer();
    expect(await addToCollection(w, catalogue, "u", "teemo", 1)).toMatch(/No card/);
    expect(w.add).not.toHaveBeenCalled();
  });

  it("tells a forgotten user nothing was saved", async () => {
    expect(await addToCollection(writer({ add: async () => null }), catalogue, "u", "ahri", 1)).toMatch(/\/show-me/);
  });
});

describe("setLending", () => {
  it("asks for a default the first time instead of turning lending on", async () => {
    const w = writer();
    expect(await setLending(w, "u", "on", null)).toMatch(/default/);
    expect(w.setLending).not.toHaveBeenCalled();
  });

  it("keeps the stored default when none is given", async () => {
    const w = writer({ lendDefault: async () => "everything" });
    expect(await setLending(w, "u", "on", null)).toMatch(/everything i own/);
    expect(w.setLending).toHaveBeenCalledWith("u", true, null);
  });

  it("saves a picked default", async () => {
    const w = writer();
    await setLending(w, "u", "on", "nothing");
    expect(w.setLending).toHaveBeenCalledWith("u", true, "nothing");
  });

  it("turns off without asking", async () => {
    const w = writer();
    expect(await setLending(w, "u", "off", null)).toMatch(/off/);
    expect(w.setLending).toHaveBeenCalledWith("u", false, null);
  });

  it("tells the caller when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setLending(writer({ setLending: async () => Promise.reject(new Error("down")) }), "u", "off", null)).toMatch(
      /nothing was changed/,
    );
  });
});
