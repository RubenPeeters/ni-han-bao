import { describe, expect, it } from "vitest";
import { formatLog } from "./log.js";

describe("formatLog", () => {
  const now = new Date("2026-10-17T10:00:00Z");

  it("writes one line of JSON with level, event and fields", () => {
    const line = formatLog("info", "flush", { guild: "g", messages: 3 }, now);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      time: "2026-10-17T10:00:00.000Z",
      level: "info",
      event: "flush",
      guild: "g",
      messages: 3,
    });
  });

  it("keeps an error's message instead of logging {}", () => {
    const parsed = JSON.parse(formatLog("error", "x", { error: new Error("boom") }, now));
    expect(parsed.error.message).toBe("boom");
    expect(parsed.error.stack).toContain("boom");
  });
});
