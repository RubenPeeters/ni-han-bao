import { describe, expect, it, vi } from "vitest";
import { addToCollection, setLending, type CollectionWriter } from "./collection.js";
import { placeholderCatalogue } from "./riftbound.js";

const catalogue = placeholderCatalogue([{ id: "Ahri", key: "103", name: "Ahri" }]);

function writer(overrides: Partial<CollectionWriter> = {}): CollectionWriter {
  return {
    add: vi.fn(async (_u, _p, n: number) => n + 1),
    setLending: vi.fn(async (_u, _l, lendAll: boolean | null) => ({ lendAll: lendAll ?? false, visibility: "members" })),
    ...overrides,
  };
}

describe("/collection add", () => {
  it("adds copies of the card's printing and says the new count", async () => {
    const w = writer();
    const reply = await addToCollection(w, catalogue, "u", "placeholder-unit-ahri", 2);
    expect(w.add).toHaveBeenCalledWith("u", "PLH-U103", 2);
    expect(reply).toContain("now have 3");
  });

  it("finds a typed collector code and keeps the count within 1 to 99", async () => {
    const w = writer();
    await addToCollection(w, catalogue, "u", "plh l103", 500);
    expect(w.add).toHaveBeenCalledWith("u", "PLH-L103", 99);
  });

  it("writes nothing for an unknown card", async () => {
    const w = writer();
    expect(await addToCollection(w, catalogue, "u", "nope", 1)).toContain("No card");
    expect(w.add).not.toHaveBeenCalled();
  });

  it("says so for a forgotten user or a failed write", async () => {
    expect(await addToCollection(writer({ add: async () => null }), catalogue, "u", "Ahri", 1)).toContain("/show-me");
    const failing = writer({ add: async () => { throw new Error("down"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addToCollection(failing, catalogue, "u", "Ahri", 1)).toContain("nothing was changed");
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
