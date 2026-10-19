import { describe, expect, it, vi } from "vitest";
import { PROFILE_COMMAND, setProfileVisibility, VISIBILITIES } from "./profile.js";

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
    const setVisibility = vi.fn(async () => {});
    const reply = await setProfileVisibility({ setVisibility }, "a", level, "https://site");
    expect(setVisibility).toHaveBeenCalledWith("a", level);
    expect(reply).toContain("https://site/u/a");
  });

  it("writes nothing for a value that is not a visibility", async () => {
    const setVisibility = vi.fn(async () => {});
    expect(await setProfileVisibility({ setVisibility }, "a", "everyone", null)).toMatch(/nothing was changed/);
    expect(setVisibility).not.toHaveBeenCalled();
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
