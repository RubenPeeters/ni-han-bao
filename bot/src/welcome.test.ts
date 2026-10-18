import { describe, expect, it, vi } from "vitest";
import { postWelcome, welcomeChannel, welcomeText } from "./welcome.js";

describe("welcomeText", () => {
  it("says what is counted, links the server's page and names /hide-me", () => {
    const text = welcomeText("https://site.example/", "123");
    expect(text).toMatch(/never what anyone writes/);
    expect(text).toContain("https://site.example/s/123/leaderboard");
    expect(text).toContain("/hide-me");
  });

  it("leaves the link out without a site URL", () => {
    expect(welcomeText(null, "123")).not.toMatch(/http/);
  });
});

describe("welcomeChannel", () => {
  const open = (c: string) => c !== "locked";

  it("prefers the system channel", () => {
    expect(welcomeChannel("system", ["a", "b"], open)).toBe("system");
  });

  it("falls back to the first channel the bot can post in", () => {
    expect(welcomeChannel("locked", ["locked", "b", "c"], open)).toBe("b");
    expect(welcomeChannel(null, ["b"], open)).toBe("b");
  });

  it("finds none when the bot can post nowhere", () => {
    expect(welcomeChannel("locked", ["locked"], open)).toBeNull();
  });
});

describe("postWelcome", () => {
  const store = (claimed: boolean) => ({ claim: vi.fn(async () => claimed), release: vi.fn(async () => {}) });
  const channel = () => ({ id: "c", send: vi.fn(async () => {}) });

  it("posts once it has claimed the server", async () => {
    const s = store(true);
    const c = channel();
    expect(await postWelcome(s, c, "hi")).toBe("posted");
    expect(s.claim).toHaveBeenCalledWith("c");
    expect(c.send).toHaveBeenCalledWith("hi");
  });

  it("does not post again in a server already welcomed", async () => {
    const c = channel();
    expect(await postWelcome(store(false), c, "hi")).toBe("already_welcomed");
    expect(c.send).not.toHaveBeenCalled();
  });

  it("claims nothing without a channel", async () => {
    const s = store(true);
    expect(await postWelcome(s, null, "hi")).toBe("no_channel");
    expect(s.claim).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails", async () => {
    const s = store(true);
    const c = { id: "c", send: vi.fn(async () => Promise.reject(new Error("missing access"))) };
    await expect(postWelcome(s, c, "hi")).rejects.toThrow("missing access");
    expect(s.release).toHaveBeenCalled();
  });
});
