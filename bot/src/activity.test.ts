import { describe, expect, it } from "vitest";
import { ActivityBuffer, displayName, shouldCount, utcDay } from "./activity.js";

const human = { guildId: "g", authorIsBot: false, webhookId: null, system: false };

describe("shouldCount", () => {
  it("counts a human message in the configured guild", () => {
    expect(shouldCount(human, "g")).toBe(true);
  });

  it.each([
    ["another guild", { ...human, guildId: "other" }],
    ["a DM", { ...human, guildId: null }],
    ["a bot", { ...human, authorIsBot: true }],
    ["a webhook", { ...human, webhookId: "w" }],
    ["a system message", { ...human, system: true }],
  ])("ignores %s", (_, msg) => {
    expect(shouldCount(msg, "g")).toBe(false);
  });
});

describe("displayName", () => {
  it("prefers nickname, then global name, then username", () => {
    expect(displayName({ nickname: "nick", globalName: "global", username: "user" })).toBe("nick");
    expect(displayName({ nickname: null, globalName: "global", username: "user" })).toBe("global");
    expect(displayName({ nickname: null, globalName: null, username: "user" })).toBe("user");
  });
});

describe("utcDay", () => {
  it("uses the UTC date, not the local one", () => {
    expect(utcDay(new Date("2026-10-17T23:59:59.999Z"))).toBe("2026-10-17");
    expect(utcDay(new Date("2026-10-18T01:30:00+02:00"))).toBe("2026-10-17");
    expect(utcDay(new Date("2026-10-18T00:00:00Z"))).toBe("2026-10-18");
  });
});

describe("ActivityBuffer", () => {
  const ann = { user_id: "1", display_name: "Ann", avatar_url: "a.png" };

  it("aggregates a burst into one row per member per UTC day", () => {
    const buf = new ActivityBuffer();
    for (let i = 0; i < 100; i++) buf.message("1", new Date("2026-10-17T12:00:00Z"));
    buf.message("1", new Date("2026-10-18T00:00:01Z"));
    buf.message("2", new Date("2026-10-17T08:00:00Z"));

    expect(buf.drain().counts).toEqual([
      { user_id: "1", day: "2026-10-17", count: 100 },
      { user_id: "1", day: "2026-10-18", count: 1 },
      { user_id: "2", day: "2026-10-17", count: 1 },
    ]);
  });

  it("keeps the latest profile per member", () => {
    const buf = new ActivityBuffer();
    buf.member(ann);
    buf.member({ ...ann, display_name: "Annie" });
    expect(buf.drain().members).toEqual([{ ...ann, display_name: "Annie" }]);
  });

  it("empties on drain", () => {
    const buf = new ActivityBuffer();
    buf.member(ann);
    buf.message("1", new Date());
    expect(buf.isEmpty).toBe(false);
    buf.drain();
    expect(buf.isEmpty).toBe(true);
    expect(buf.drain()).toEqual({ members: [], counts: [] });
  });

  it("restores a failed batch, adding to counts buffered since and keeping newer profiles", () => {
    const buf = new ActivityBuffer();
    buf.member(ann);
    buf.message("1", new Date("2026-10-17T12:00:00Z"), 3);
    const failed = buf.drain();

    buf.member({ ...ann, display_name: "Annie" });
    buf.message("1", new Date("2026-10-17T13:00:00Z"));
    buf.restore(failed);

    expect(buf.drain()).toEqual({
      members: [{ ...ann, display_name: "Annie" }],
      counts: [{ user_id: "1", day: "2026-10-17", count: 4 }],
    });
  });
});
