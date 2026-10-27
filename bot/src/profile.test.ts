import { describe, expect, it, vi } from "vitest";
import { championChoices, matchChampion, PROFILE_COMMAND, setFavouriteChampion, setProfileVisibility, VISIBILITIES } from "./profile.js";

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

const CHAMPIONS = [
  { id: "Ahri", name: "Ahri" },
  { id: "MonkeyKing", name: "Wukong" },
  { id: "KaiSa", name: "Kai'Sa" },
  { id: "LeeSin", name: "Lee Sin" },
  { id: "Akali", name: "Akali" },
];

describe("matchChampion", () => {
  it.each([
    ["wukong", "MonkeyKing"],
    ["MonkeyKing", "MonkeyKing"],
    ["  lee sin ", "LeeSin"],
    ["Kai Sa", "KaiSa"],
    ["Àhrí", "Ahri"],
  ])("finds %s as %s", (typed, id) => {
    expect(matchChampion(CHAMPIONS, typed)).toBe(id);
  });

  it("guesses nothing for a part of a name", () => {
    expect(matchChampion(CHAMPIONS, "ah")).toBeNull();
  });
});

describe("championChoices", () => {
  it("suggests names starting with what was typed first, by id", () => {
    expect(championChoices(CHAMPIONS, "a")).toEqual([
      { name: "Ahri", value: "Ahri" },
      { name: "Akali", value: "Akali" },
      { name: "Kai'Sa", value: "KaiSa" },
    ]);
    expect(championChoices(CHAMPIONS, "monkey")).toEqual([{ name: "Wukong", value: "MonkeyKing" }]);
  });

  it("offers at most Discord's 25", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `C${i}`, name: `C${i}` }));
    expect(championChoices(many, "")).toHaveLength(25);
  });
});

describe("setFavouriteChampion", () => {
  it("saves the id of a typed name", async () => {
    const setChampion = vi.fn(async () => true);
    const reply = await setFavouriteChampion({ setChampion }, CHAMPIONS, "a", "Wukong", "https://site");
    expect(setChampion).toHaveBeenCalledWith("a", "MonkeyKing");
    expect(reply).toBe("Your favourite champion is now Wukong. https://site/u/a");
  });

  it("clears it without a champion", async () => {
    const setChampion = vi.fn(async () => true);
    expect(await setFavouriteChampion({ setChampion }, [], "a", null, null)).toMatch(/cleared/);
    expect(setChampion).toHaveBeenCalledWith("a", null);
  });

  it("writes nothing for a name that is no champion, or without the list", async () => {
    const setChampion = vi.fn(async () => true);
    expect(await setFavouriteChampion({ setChampion }, CHAMPIONS, "a", "Pikachu", null)).toMatch(/No champion called "Pikachu"/);
    expect(await setFavouriteChampion({ setChampion }, [], "a", "Ahri", null)).toMatch(/nothing was changed/);
    expect(setChampion).not.toHaveBeenCalled();
  });

  it("tells a forgotten user nothing was saved", async () => {
    expect(await setFavouriteChampion({ setChampion: async () => false }, CHAMPIONS, "a", "Ahri", null)).toMatch(/\/show-me/);
  });
});
