import { describe, expect, it } from "vitest";
import { fillPhrase, nextPresence, PRESENCE_PHRASES } from "./presence.js";

const stats = { messagesToday: 1234, busiestChannel: "general", members: 56 };

describe("fillPhrase", () => {
  it("fills placeholders with formatted numbers", () => {
    expect(fillPhrase("watching {messages} messages today", stats)).toBe(
      "watching 1,234 messages today",
    );
    expect(fillPhrase("judging #{channel}", stats)).toBe("judging #general");
  });

  it("returns null when a placeholder has no value", () => {
    expect(fillPhrase("judging #{channel}", { ...stats, busiestChannel: null })).toBeNull();
    expect(fillPhrase("{nonsense}", stats)).toBeNull();
  });

  it("every built-in phrase fills", () => {
    for (const p of PRESENCE_PHRASES) expect(fillPhrase(p, stats)).not.toBeNull();
  });
});

describe("nextPresence", () => {
  const phrases = ["a {messages}", "b #{channel}", "c {members}"];

  it("rotates through the phrases and wraps", () => {
    expect(nextPresence(phrases, 0, stats)).toEqual({ text: "a 1,234", next: 1 });
    expect(nextPresence(phrases, 2, stats)).toEqual({ text: "c 56", next: 0 });
  });

  it("skips phrases that cannot be filled", () => {
    expect(nextPresence(phrases, 1, { ...stats, busiestChannel: null })).toEqual({
      text: "c 56",
      next: 0,
    });
  });

  it("returns null when nothing can be filled", () => {
    expect(nextPresence(["#{channel}"], 0, { ...stats, busiestChannel: null })).toBeNull();
  });
});
