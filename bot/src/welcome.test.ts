import { describe, expect, it } from "vitest";
import { welcomeChannel, welcomeText } from "./welcome.js";

const open = (id: string) => ({ id, sendable: true });
const closed = (id: string) => ({ id, sendable: false });

describe("welcomeChannel", () => {
  it("prefers the system channel", () => {
    expect(welcomeChannel(open("sys"), [open("a")])?.id).toBe("sys");
  });

  it("falls back to the first channel the bot can write in", () => {
    expect(welcomeChannel(closed("sys"), [closed("a"), open("b"), open("c")])?.id).toBe("b");
    expect(welcomeChannel(null, [open("a")])?.id).toBe("a");
  });

  it("is null when the bot cannot write anywhere", () => {
    expect(welcomeChannel(closed("sys"), [closed("a")])).toBeNull();
    expect(welcomeChannel(null, [])).toBeNull();
  });
});

describe("welcomeText", () => {
  it("links the server's stats page and names the commands", () => {
    const text = welcomeText("123", "https://nihanbao.example/");
    expect(text).toContain("https://nihanbao.example/s/123/leaderboard");
    expect(text).toContain("never what anyone writes");
    expect(text).toContain("/hide-me");
  });

  it("leaves the link out without a site URL", () => {
    expect(welcomeText("123", null)).not.toContain("http");
  });
});
