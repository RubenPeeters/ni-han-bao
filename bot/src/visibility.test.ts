import { describe, expect, it, vi } from "vitest";
import { hiddenFor, setVisibility, VISIBILITY_COMMANDS } from "./visibility.js";

const alice = { user_id: "a", display_name: "Alice", avatar_url: null };

describe("hiddenFor", () => {
  it("maps each registered command to its flag", () => {
    expect(VISIBILITY_COMMANDS.map((c) => [c.name, hiddenFor(c.name)])).toEqual([
      ["hide-me", true],
      ["show-me", false],
    ]);
  });

  it("ignores other commands", () => {
    expect(hiddenFor("ping")).toBeNull();
  });
});

describe("setVisibility", () => {
  it.each([true, false])("writes hidden=%s for the caller", async (hidden) => {
    const setHidden = vi.fn(async () => {});
    const reply = await setVisibility({ setHidden }, alice, hidden);
    expect(setHidden).toHaveBeenCalledWith(alice, hidden);
    expect(reply).toMatch(hidden ? /now hidden/ : /visible/);
  });

  it("tells the caller when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = await setVisibility(
      { setHidden: async () => Promise.reject(new Error("down")) },
      alice,
      true,
    );
    expect(reply).toMatch(/nothing was changed/);
  });
});
