import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { addToCollection, setLending, type CollectionWriter } from "./collection.js";
import type { Catalogue } from "./riftbound.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;

function writer(overrides: Partial<CollectionWriter> = {}): CollectionWriter {
  return {
    add: vi.fn(async (_u, _p, n: number, language: string | null) => ({ total: n + 1, language: language ?? "zh-Hans" })),
    setLending: vi.fn(async (_u, _l, lendAll: boolean | null) => ({ lendAll: lendAll ?? false, visibility: "members" })),
    ...overrides,
  };
}

describe("/collection add", () => {
  it("adds copies of the card's printing in the chosen language and says the new count", async () => {
    const w = writer();
    const reply = await addToCollection(w, catalogue, "u", "ahri-alluring", 2, "fr");
    expect(w.add).toHaveBeenCalledWith("u", "ogn-066-298", 2, "fr");
    expect(reply).toContain("now have 3 normal NM in French");
  });

  it("leaves the language to the last-used one and names it", async () => {
    const w = writer();
    const reply = await addToCollection(w, catalogue, "u", "Ahri", 1, null);
    expect(w.add).toHaveBeenCalledWith("u", expect.any(String), 1, null);
    expect(reply).toContain("in Chinese (Simplified)");
  });

  it("finds a typed collector code and keeps the count within 1 to 99", async () => {
    const w = writer();
    await addToCollection(w, catalogue, "u", "ogn 255", 500, null);
    expect(w.add).toHaveBeenCalledWith("u", "ogn-255-298", 99, null);
  });

  it("writes nothing for an unknown card", async () => {
    const w = writer();
    expect(await addToCollection(w, catalogue, "u", "nope", 1, null)).toContain("No card");
    expect(w.add).not.toHaveBeenCalled();
  });

  it("says so for a forgotten user or a failed write", async () => {
    expect(await addToCollection(writer({ add: async () => null }), catalogue, "u", "Ahri", 1, null)).toContain("/show-me");
    const failing = writer({ add: async () => { throw new Error("down"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addToCollection(failing, catalogue, "u", "Ahri", 1, null)).toContain("nothing was changed");
  });
});

describe("/collection lending", () => {
  it("turns lending on with the chosen default", async () => {
    const w = writer();
    const reply = await setLending(w, "u", "on", "everything", null);
    expect(w.setLending).toHaveBeenCalledWith("u", true, true);
    expect(reply).toContain("everything you own");
  });

  it("keeps the current default when none is given, and says how to change it", async () => {
    const w = writer();
    const reply = await setLending(w, "u", "on", null, "https://x");
    expect(w.setLending).toHaveBeenCalledWith("u", true, null);
    expect(reply).toContain("nothing is lendable");
    expect(reply).toContain("`default`");
    expect(reply).toContain("https://x/u/u/collection");
  });

  it("warns that a private profile is never listed", async () => {
    const w = writer({ setLending: async () => ({ lendAll: false, visibility: "private" }) });
    expect(await setLending(w, "u", "on", null, null)).toContain("private");
  });

  it("turns lending off without touching the default", async () => {
    const w = writer();
    expect(await setLending(w, "u", "off", "everything", null)).toContain("off");
    expect(w.setLending).toHaveBeenCalledWith("u", false, null);
  });
});
