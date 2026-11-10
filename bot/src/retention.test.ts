import { describe, expect, it } from "vitest";
import { retentionPlan } from "./retention.js";

describe("retentionPlan", () => {
  it("marks servers the bot is no longer in, and forgets only those already marked", () => {
    const plan = retentionPlan(
      [
        { guild_id: "present", left_at: null },
        { guild_id: "removed-offline", left_at: null },
        { guild_id: "left", left_at: "2026-10-01T00:00:00Z" },
        { guild_id: "back", left_at: "2026-10-01T00:00:00Z" },
      ],
      new Set(["present", "back", "never-stored"]),
    );
    expect(plan).toEqual({ markLeft: ["removed-offline"], forget: ["left"] });
  });

  it("does nothing while the bot is in every stored server", () => {
    expect(retentionPlan([{ guild_id: "a", left_at: null }], new Set(["a"]))).toEqual({ markLeft: [], forget: [] });
  });
});
