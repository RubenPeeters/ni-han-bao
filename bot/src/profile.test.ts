import { describe, expect, it, vi } from "vitest";
import { parseChampions } from "./champions.js";
import { PROFILE_COMMAND, setFavouriteChampion, setProfileVisibility, VISIBILITIES } from "./profile.js";

describe("PROFILE_COMMAND", () => {
  it("offers every visibility the profiles table accepts", () => {
    const level = PROFILE_COMMAND.options[0].options[0];
    expect(level.choices.map((c) => c.value)).toEqual(["private", "members", "public"]);
    // Discord rejects choice names over 100 characters.
    for (const c of level.choices) expect(c.name.length).toBeLessThanOrEqual(100);
  });
});

describe("setProfileVisibility", () => {
  it.each(VISIBILITIES)("writes %s for the caller and links their page", async (level) => {
    const setVisibility = vi.fn(async () => true);
    const reply = await setProfileVisibility({ setVisibility }, "a", level, "https://site");
    expect(setVisibility).toHaveBeenCalledWith("a", level);
    expect(reply).toContain("https://site/u/a");
  });

  it("writes nothing for a value that is not a visibility", async () => {
    const setVisibility = vi.fn(async () => true);
    expect(await setProfileVisibility({ setVisibility }, "a", "everyone", null)).toMatch(/nothing was changed/);
    expect(setVisibility).not.toHaveBeenCalled();
  });

  it("tells a forgotten user nothing was saved", async () => {
    const reply = await setProfileVisibility({ setVisibility: async () => false }, "a", "public", null);
    expect(reply).toMatch(/\/show-me/);
  });

  it("tells the caller when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = await setProfileVisibility(
      { setVisibility: async () => Promise.reject(new Error("down")) },
      "a",
      "public",
      null,
    );
    expect(reply).toMatch(/nothing was changed/);
  });
});

describe("setFavouriteChampion", () => {
  const champions = async () => parseChampions({ MonkeyKing: { id: "MonkeyKing", name: "Wukong" }, Ahri: { id: "Ahri", name: "Ahri" } });

  it("stores the id of a typed name", async () => {
    const setFavourite = vi.fn(async () => true);
    const reply = await setFavouriteChampion({ setFavourite }, "a", "Wukong", champions, "https://site");
    expect(setFavourite).toHaveBeenCalledWith("a", "MonkeyKing");
    expect(reply).toMatch(/Wukong/);
    expect(reply).toContain("https://site/u/a");
  });

  it("clears it without a champion, without loading the list", async () => {
    const setFavourite = vi.fn(async () => true);
    const list = vi.fn(champions);
    await setFavouriteChampion({ setFavourite }, "a", null, list, null);
    expect(setFavourite).toHaveBeenCalledWith("a", null);
    expect(list).not.toHaveBeenCalled();
  });

  it("writes nothing for an unknown champion or when Data Dragon is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setFavourite = vi.fn(async () => true);
    expect(await setFavouriteChampion({ setFavourite }, "a", "Nobody", champions, null)).toMatch(/nothing was changed/);
    expect(await setFavouriteChampion({ setFavourite }, "a", "Ahri", () => Promise.reject(new Error("down")), null)).toMatch(/nothing was changed/);
    expect(setFavourite).not.toHaveBeenCalled();
  });

  it("tells a forgotten user nothing was saved", async () => {
    expect(await setFavouriteChampion({ setFavourite: async () => false }, "a", "Ahri", champions, null)).toMatch(/\/show-me/);
  });
});
