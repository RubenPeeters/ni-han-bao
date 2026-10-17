import { describe, expect, it, vi } from "vitest";
import {
  ActivityBuffer,
  displayName,
  flushActivity,
  shouldCount,
  utcDay,
  type ActivityWriter,
} from "./activity.js";

const GUILD = "g1";
const human = { guildId: GUILD, authorIsBot: false, webhookId: null, system: false };
const alice = { user_id: "a", display_name: "Alice", avatar_url: "https://cdn/a.png" };

describe("shouldCount", () => {
  it("counts a member message in our guild", () => {
    expect(shouldCount(human, GUILD)).toBe(true);
  });

  it.each([
    ["another guild", { ...human, guildId: "other" }],
    ["a DM", { ...human, guildId: null }],
    ["a bot", { ...human, authorIsBot: true }],
    ["a webhook", { ...human, webhookId: "w1" }],
    ["a system message", { ...human, system: true }],
  ])("ignores %s", (_label, message) => {
    expect(shouldCount(message, GUILD)).toBe(false);
  });
});

describe("utcDay", () => {
  it("uses the UTC date, not the local one", () => {
    expect(utcDay(new Date("2026-10-18T23:59:59-02:00"))).toBe("2026-10-19");
    expect(utcDay(new Date("2026-10-19T00:30:00+02:00"))).toBe("2026-10-18");
  });
});

describe("displayName", () => {
  it("prefers nickname, then global name, then username", () => {
    expect(displayName({ nickname: "Nick", globalName: "Global", username: "user" })).toBe("Nick");
    expect(displayName({ nickname: null, globalName: "Global", username: "user" })).toBe("Global");
    expect(displayName({ nickname: null, globalName: null, username: "user" })).toBe("user");
  });
});

describe("ActivityBuffer", () => {
  it("aggregates a burst into one row per member per UTC day", () => {
    const buf = new ActivityBuffer();
    for (let i = 0; i < 50; i++) buf.addMessage("a", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("a", new Date("2026-10-18T00:00:01Z"));
    buf.addMessage("b", new Date("2026-10-17T23:59:59Z"));
    expect(buf.drain().counts).toEqual([
      { user_id: "a", day: "2026-10-17", count: 50 },
      { user_id: "a", day: "2026-10-18", count: 1 },
      { user_id: "b", day: "2026-10-17", count: 1 },
    ]);
  });

  it("keeps the latest member snapshot", () => {
    const buf = new ActivityBuffer();
    buf.setMember(alice);
    buf.setMember({ ...alice, display_name: "Alice 2" });
    expect(buf.drain().members).toEqual([{ ...alice, display_name: "Alice 2" }]);
  });

  it("is empty after a drain", () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", new Date());
    buf.setMember(alice);
    buf.drain();
    expect(buf.isEmpty).toBe(true);
    expect(buf.drain()).toEqual({ members: [], counts: [] });
  });

  it("restores a failed batch on top of newer activity", () => {
    const buf = new ActivityBuffer();
    const day = new Date("2026-10-17T10:00:00Z");
    buf.addMessage("a", day);
    buf.addMessage("a", day);
    buf.setMember(alice);
    const failed = buf.drain();

    buf.addMessage("a", day);
    buf.setMember({ ...alice, display_name: "Newer" });
    buf.restore(failed);

    expect(buf.drain()).toEqual({
      members: [{ ...alice, display_name: "Newer" }],
      counts: [{ user_id: "a", day: "2026-10-17", count: 3 }],
    });
  });
});

function writer(overrides: Partial<ActivityWriter> = {}): ActivityWriter {
  return {
    upsertMembers: vi.fn(async () => {}),
    incrementCounts: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("flushActivity", () => {
  const day = new Date("2026-10-17T10:00:00Z");

  it("writes members before counts and empties the buffer", async () => {
    const order: string[] = [];
    const buf = new ActivityBuffer();
    buf.addMessage("a", day);
    buf.setMember(alice);
    await flushActivity(
      buf,
      writer({
        upsertMembers: async (rows) => void order.push(`members:${rows.length}`),
        incrementCounts: async (rows) => void order.push(`counts:${rows.length}`),
      }),
    );
    expect(order).toEqual(["members:1", "counts:1"]);
    expect(buf.isEmpty).toBe(true);
  });

  it("does nothing when there is nothing buffered", async () => {
    const w = writer();
    await flushActivity(new ActivityBuffer(), w);
    expect(w.upsertMembers).not.toHaveBeenCalled();
    expect(w.incrementCounts).not.toHaveBeenCalled();
  });

  it("keeps everything when the members write fails", async () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", day);
    buf.setMember(alice);
    const w = writer({ upsertMembers: async () => Promise.reject(new Error("down")) });
    await expect(flushActivity(buf, w)).rejects.toThrow("down");
    expect(w.incrementCounts).not.toHaveBeenCalled();
    expect(buf.drain()).toEqual({
      members: [alice],
      counts: [{ user_id: "a", day: "2026-10-17", count: 1 }],
    });
  });

  it("keeps only the counts when the counts write fails", async () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", day);
    buf.setMember(alice);
    const w = writer({ incrementCounts: async () => Promise.reject(new Error("down")) });
    await expect(flushActivity(buf, w)).rejects.toThrow("down");
    expect(buf.drain()).toEqual({
      members: [],
      counts: [{ user_id: "a", day: "2026-10-17", count: 1 }],
    });
  });
});
