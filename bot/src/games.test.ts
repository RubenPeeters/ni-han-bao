import { describe, expect, it, vi } from "vitest";
import { flushGames, gameApps, GameBuffer, gameKeys, GameSessions, MAX_SESSION_S, type GameBatch } from "./games.js";

const at = (time: string, day = "17") => new Date(`2026-10-${day}T${time}Z`);

describe("gameKeys", () => {
  it("keeps playing, streaming and competing, by name only", () => {
    expect(
      gameKeys([
        { type: 0, name: "Riftbound " },
        { type: 1, name: "Twitch" },
        { type: 2, name: "Spotify" },
        { type: 3, name: "YouTube" },
        { type: 4, name: "Custom Status" },
        { type: 5, name: "Arena" },
      ]),
    ).toEqual(["playing:Riftbound", "streaming:Twitch", "competing:Arena"]);
  });

  it("drops empty names and counts a duplicate once", () => {
    expect(gameKeys([{ type: 0, name: " " }, { type: 0, name: "A" }, { type: 0, name: "A" }])).toEqual(["playing:A"]);
  });
});

describe("gameApps", () => {
  it("maps game names to their application id, games only and only when Discord sends one", () => {
    expect(
      gameApps([
        { type: 0, name: "League of Legends ", applicationId: "401518684763586560" },
        { type: 0, name: "Riftbound", applicationId: null },
        { type: 1, name: "Twitch", applicationId: "1" },
        { type: 5, name: "Arena", applicationId: "2" },
        { type: 0, name: " ", applicationId: "3" },
      ]),
    ).toEqual(
      new Map([
        ["League of Legends", "401518684763586560"],
        ["Arena", "2"],
      ]),
    );
  });
});

describe("GameSessions", () => {
  it("counts a session from first sight to its end", () => {
    const s = new GameSessions();
    expect(s.update("a", ["playing:A"], at("10:00:00"))).toEqual([]);
    expect(s.update("a", [], at("10:30:00"))).toEqual([
      { user_id: "a", day: "2026-10-17", kind: "playing", name: "A", seconds: 1800, live: false },
    ]);
    expect(s.size).toBe(0);
  });

  it("counts the same presence from several servers once", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("10:00:00"));
    s.update("a", ["playing:A"], at("10:10:00"));
    expect(s.update("a", [], at("10:20:00"))).toMatchObject([{ seconds: 1200 }]);
  });

  it("closes only the activities that stopped", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A", "streaming:Twitch"], at("10:00:00"));
    s.update("b", ["playing:A"], at("10:00:00"));
    expect(s.update("a", ["playing:A"], at("10:01:00"))).toMatchObject([{ user_id: "a", kind: "streaming", seconds: 60 }]);
    expect(s.size).toBe(2);
  });

  it("collects open sessions as live and keeps them open", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("10:00:00"));
    expect(s.collect(at("10:00:10"))).toMatchObject([{ seconds: 10, live: true }]);
    expect(s.collect(at("10:00:30"))).toMatchObject([{ seconds: 20, live: true }]);
    expect(s.closeAll(at("10:01:00"))).toMatchObject([{ seconds: 30, live: false }]);
  });

  it("splits at UTC midnight", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("23:59:00"));
    expect(s.update("a", [], at("00:01:00", "18")).map((r) => [r.day, r.seconds])).toEqual([
      ["2026-10-17", 60],
      ["2026-10-18", 60],
    ]);
  });

  it("drops a session at twelve hours, counting up to the cap", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("00:00:00"));
    const rows = s.collect(at("20:00:00"));
    expect(rows.reduce((n, r) => n + r.seconds, 0)).toBe(MAX_SESSION_S);
    expect(rows.every((r) => !r.live)).toBe(true);
    expect(s.size).toBe(0);
  });

  it("closes sessions only for users who no longer share a server", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("10:00:00"));
    s.update("b", ["playing:B"], at("10:00:00"));
    // a left their last shared server; b left one of two.
    expect(s.closeUnless((u) => u === "b", at("10:10:00"))).toMatchObject([{ user_id: "a", seconds: 600, live: false }]);
    expect(s.collect(at("10:20:00"))).toMatchObject([{ user_id: "b", seconds: 1200, live: true }]);
  });

  it("drops a user's sessions uncounted and counts again from a restart", () => {
    const s = new GameSessions();
    s.update("a", ["playing:A"], at("10:00:00"));
    s.drop("a");
    expect(s.collect(at("10:30:00"))).toEqual([]);
    s.update("a", ["playing:A"], at("10:30:00"));
    expect(s.collect(at("10:40:00"))).toMatchObject([{ seconds: 600 }]);
  });
});

describe("GameBuffer", () => {
  it("adds seconds per key and keeps the latest state", () => {
    const b = new GameBuffer();
    const row = { user_id: "a", day: "2026-10-17", kind: "playing" as const, name: "A", seconds: 10, live: true };
    b.add([row]);
    b.add([{ ...row, seconds: 5, live: false }]);
    expect(b.drain()).toEqual([{ ...row, seconds: 15, live: false }]);
    expect(b.drain()).toEqual([]);
  });
});

describe("flushGames", () => {
  const row = { user_id: "a", day: "2026-10-17", kind: "playing" as const, name: "A", seconds: 10, live: true };

  it("does nothing when empty", async () => {
    const incrementGames = vi.fn(async () => {});
    await flushGames(new GameBuffer(), { incrementGames });
    expect(incrementGames).not.toHaveBeenCalled();
  });

  it("resends a failed batch under its id before newer rows", async () => {
    const b = new GameBuffer();
    b.add([row]);
    const sent: GameBatch[] = [];
    const fail = { incrementGames: vi.fn(async () => Promise.reject(new Error("down"))) };
    await expect(flushGames(b, fail, () => "1")).rejects.toThrow("down");
    b.add([{ ...row, seconds: 5 }]);
    await expect(flushGames(b, fail, () => "2")).rejects.toThrow("down");
    const ok = { incrementGames: vi.fn(async (batch: GameBatch) => void sent.push(batch)) };
    await flushGames(b, ok, () => "3");
    expect(sent).toEqual([
      { id: "1", games: [row] },
      { id: "3", games: [{ ...row, seconds: 5 }] },
    ]);
    expect(b.seconds).toBe(0);
  });

  it("never sends time dropped by a hide or show, not even in a retried batch", async () => {
    const b = new GameBuffer();
    b.add([row, { ...row, user_id: "b" }]);
    const fail = { incrementGames: vi.fn(async () => Promise.reject(new Error("down"))) };
    await expect(flushGames(b, fail, () => "1")).rejects.toThrow("down");
    b.add([{ ...row, seconds: 5 }]);
    b.drop("a");
    const sent: GameBatch[] = [];
    await flushGames(b, { incrementGames: async (batch) => void sent.push(batch) }, () => "2");
    expect(sent).toEqual([{ id: "1", games: [{ ...row, user_id: "b" }] }]);
  });
});
