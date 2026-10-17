import { describe, expect, it } from "vitest";
import { PRESENCE_PHRASES, presenceText } from "./presence.js";

const stats = { messagesToday: 1234, busiestChannel: "general", memberCount: 56 };

describe("presenceText", () => {
  it("rotates through the phrases and wraps around", () => {
    expect(presenceText(stats, 0)).toBe("watching 1,234 messages today");
    expect(presenceText(stats, 1)).toBe("judging #general");
    expect(presenceText(stats, PRESENCE_PHRASES.length)).toBe(presenceText(stats, 0));
  });

  it("skips a phrase with nothing to say", () => {
    expect(presenceText({ ...stats, busiestChannel: null }, 1)).toBe("keeping an eye on 56 members");
  });
});
