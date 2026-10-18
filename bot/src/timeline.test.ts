import { describe, expect, it, vi } from "vitest";
import {
  flushTimeline,
  splitByDay,
  TimelineBuffer,
  VoiceSessions,
  type TimelineBatch,
  type TimelineWriter,
  type VoiceSecondsRow,
} from "./timeline.js";

const alice = { user_id: "a", display_name: "Alice", avatar_url: "https://cdn/a.png" };
const at = (time: string) => new Date(`2026-10-17T${time}Z`);

/** Seconds per user and day, so tests do not depend on how rows were sliced. */
function total(rows: VoiceSecondsRow[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.user_id}:${r.day}`;
    sums[key] = (sums[key] ?? 0) + r.seconds;
  }
  return sums;
}

describe("splitByDay", () => {
  it("keeps a span inside one day whole", () => {
    const from = at("10:00:00").getTime() / 1000;
    expect(splitByDay("a", from, from + 90, "UTC")).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 90 },
    ]);
  });

  it("splits a span at UTC midnight", () => {
    const from = at("23:59:00").getTime() / 1000;
    expect(splitByDay("a", from, from + 120, "UTC")).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 60 },
      { user_id: "a", day: "2026-10-18", seconds: 60 },
    ]);
  });

  it("gives a whole day in between all 86400 seconds", () => {
    const from = at("23:00:00").getTime() / 1000;
    const rows = splitByDay("a", from, from + 3600 + 86400 + 1800, "UTC");
    expect(rows.map((r) => [r.day, r.seconds])).toEqual([
      ["2026-10-17", 3600],
      ["2026-10-18", 86400],
      ["2026-10-19", 1800],
    ]);
  });

  it("returns nothing for an empty span", () => {
    expect(splitByDay("a", 100, 100, "UTC")).toEqual([]);
  });

  it("splits at the server's midnight, which moves with DST", () => {
    // Brussels: midnight is 22:00 UTC in summer; 25 Oct 2026 has 25 hours and ends at 23:00 UTC.
    const from = new Date("2026-10-24T21:00:00Z").getTime() / 1000;
    const rows = splitByDay("a", from, from + 3 * 3600 + 25 * 3600, "Europe/Brussels");
    expect(rows.map((r) => [r.day, r.seconds])).toEqual([
      ["2026-10-24", 3600],
      ["2026-10-25", 25 * 3600],
      ["2026-10-26", 2 * 3600],
    ]);
  });
});

describe("VoiceSessions", () => {
  it("counts the time between joining and leaving", () => {
    const voice = new VoiceSessions();
    expect(voice.update("a", true, at("10:00:00"))).toEqual([]);
    expect(voice.update("a", false, at("10:30:00"))).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 1800 },
    ]);
    expect(voice.size).toBe(0);
  });

  it("keeps counting across a channel move, without counting the time twice", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("10:00:00"));
    // A move arrives as another update that is still in voice.
    expect(voice.update("a", true, at("10:10:00"))).toEqual([]);
    expect(total(voice.update("a", false, at("10:30:00")))).toEqual({ "a:2026-10-17": 1800 });
  });

  it("ignores a leave without a join", () => {
    expect(new VoiceSessions().update("a", false, at("10:00:00"))).toEqual([]);
  });

  it("tracks members separately", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("10:00:00"));
    voice.update("b", true, at("10:20:00"));
    expect(total(voice.update("a", false, at("10:30:00")))).toEqual({ "a:2026-10-17": 1800 });
    expect(total(voice.update("b", false, at("10:30:00")))).toEqual({ "b:2026-10-17": 600 });
  });

  it("collect counts open sessions so far, and never the same time twice", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("10:00:00"));
    const rows = [
      ...voice.collect(at("10:00:10")),
      ...voice.collect(at("10:00:20")),
      ...voice.update("a", false, at("10:01:00")),
    ];
    expect(total(rows)).toEqual({ "a:2026-10-17": 60 });
    expect(voice.size).toBe(0);
  });

  it("splits a session that runs past midnight", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("23:50:00"));
    expect(total(voice.update("a", false, new Date("2026-10-18T00:20:00Z")))).toEqual({
      "a:2026-10-17": 600,
      "a:2026-10-18": 1200,
    });
  });

  it("drops sub-second remainders consistently instead of accumulating them", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, new Date("2026-10-17T10:00:00.900Z"));
    const rows = [
      ...voice.collect(new Date("2026-10-17T10:00:01.100Z")),
      ...voice.collect(new Date("2026-10-17T10:00:01.900Z")),
      ...voice.update("a", false, new Date("2026-10-17T10:00:03.500Z")),
    ];
    expect(total(rows)).toEqual({ "a:2026-10-17": 3 });
  });

  it("counts nothing if the clock goes backwards", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("10:00:00"));
    expect(voice.update("a", false, at("09:00:00"))).toEqual([]);
  });

  it("closeAll ends every session at shutdown", () => {
    const voice = new VoiceSessions();
    voice.update("a", true, at("10:00:00"));
    voice.update("b", true, at("10:15:00"));
    expect(total(voice.closeAll(at("10:30:00")))).toEqual({
      "a:2026-10-17": 1800,
      "b:2026-10-17": 900,
    });
    expect(voice.size).toBe(0);
    expect(voice.collect(at("12:00:00"))).toEqual([]);
  });

  describe("across a restart", () => {
    it("counts up to shutdown, then from startup, and not the downtime", () => {
      const before = new VoiceSessions();
      before.update("a", true, at("10:00:00"));
      const shutdownRows = before.closeAll(at("10:30:00"));

      // The new process only knows who Discord says is in voice when it is ready.
      const after = new VoiceSessions();
      const startupRows = after.sync(["a"], at("10:45:00"));
      const leaveRows = after.update("a", false, at("11:00:00"));

      expect(total([...shutdownRows, ...startupRows, ...leaveRows])).toEqual({
        "a:2026-10-17": 1800 + 900,
      });
    });

    it("after a crash, a session open at the time is not counted past the last collect", () => {
      const crashed = new VoiceSessions();
      crashed.update("a", true, at("10:00:00"));
      const flushed = crashed.collect(at("10:10:00"));
      // The process dies here: no closeAll, and nothing open was ever written.

      const after = new VoiceSessions();
      expect(after.sync([], at("18:00:00"))).toEqual([]);
      expect(after.collect(at("23:00:00"))).toEqual([]);
      expect(total(flushed)).toEqual({ "a:2026-10-17": 600 });
    });

    it("sync closes sessions of members who left while events were missed", () => {
      const voice = new VoiceSessions();
      voice.update("a", true, at("10:00:00"));
      voice.update("b", true, at("10:00:00"));
      expect(total(voice.sync(["b", "c"], at("10:10:00")))).toEqual({ "a:2026-10-17": 600 });
      // b stays open from 10:00, c opens at 10:10.
      expect(total(voice.closeAll(at("10:20:00")))).toEqual({
        "b:2026-10-17": 1200,
        "c:2026-10-17": 600,
      });
    });
  });
});

describe("TimelineBuffer", () => {
  it("sums joins and leaves per UTC day", () => {
    const buffer = new TimelineBuffer();
    buffer.addJoin(at("10:00:00"));
    buffer.addJoin(at("11:00:00"));
    buffer.addLeave(at("12:00:00"));
    buffer.addLeave(new Date("2026-10-18T01:00:00Z"));
    expect(buffer.drain().flow).toEqual([
      { day: "2026-10-17", joins: 2, leaves: 1 },
      { day: "2026-10-18", joins: 0, leaves: 1 },
    ]);
  });

  it("sums voice slices per member and day", () => {
    const buffer = new TimelineBuffer();
    buffer.addVoice([{ user_id: "a", day: "2026-10-17", seconds: 10 }]);
    buffer.addVoice([{ user_id: "a", day: "2026-10-17", seconds: 5 }]);
    expect(buffer.drain().voice).toEqual([{ user_id: "a", day: "2026-10-17", seconds: 15 }]);
  });

  it("restores drained data under anything newer", () => {
    const buffer = new TimelineBuffer();
    buffer.setMember(alice);
    buffer.addJoin(at("10:00:00"));
    buffer.addVoice([{ user_id: "a", day: "2026-10-17", seconds: 10 }]);
    const drained = buffer.drain();
    buffer.setMember({ ...alice, display_name: "Alicia" });
    buffer.addJoin(at("11:00:00"));
    buffer.restore(drained);
    expect(buffer.drain()).toEqual({
      members: [{ ...alice, display_name: "Alicia" }],
      flow: [{ day: "2026-10-17", joins: 2, leaves: 0 }],
      voice: [{ user_id: "a", day: "2026-10-17", seconds: 10 }],
    });
  });
});

describe("flushTimeline", () => {
  function writer(overrides: Partial<TimelineWriter> = {}) {
    return {
      upsertMembers: vi.fn(async () => {}),
      incrementTimeline: vi.fn(async (_b: TimelineBatch) => {}),
      ...overrides,
    };
  }

  it("does nothing when empty", async () => {
    const w = writer();
    await flushTimeline(new TimelineBuffer(), w);
    expect(w.upsertMembers).not.toHaveBeenCalled();
    expect(w.incrementTimeline).not.toHaveBeenCalled();
  });

  it("writes members before the voice time that references them", async () => {
    const calls: string[] = [];
    const w = writer({
      upsertMembers: vi.fn(async () => void calls.push("members")),
      incrementTimeline: vi.fn(async () => void calls.push("timeline")),
    });
    const buffer = new TimelineBuffer();
    buffer.setMember(alice);
    buffer.addVoice([{ user_id: "a", day: "2026-10-17", seconds: 10 }]);
    await flushTimeline(buffer, w, () => "b1");
    expect(calls).toEqual(["members", "timeline"]);
    expect(w.incrementTimeline).toHaveBeenCalledWith({
      id: "b1",
      flow: [],
      voice: [{ user_id: "a", day: "2026-10-17", seconds: 10 }],
    });
    expect(buffer.isEmpty).toBe(true);
  });

  it("keeps everything when the member upsert fails", async () => {
    const buffer = new TimelineBuffer();
    buffer.setMember(alice);
    buffer.addJoin(at("10:00:00"));
    const w = writer({ upsertMembers: vi.fn(async () => Promise.reject(new Error("down"))) });
    await expect(flushTimeline(buffer, w)).rejects.toThrow("down");
    expect(w.incrementTimeline).not.toHaveBeenCalled();
    expect(buffer.drain().flow).toEqual([{ day: "2026-10-17", joins: 1, leaves: 0 }]);
  });

  it("resends a failed batch under the same id before newer counts", async () => {
    const buffer = new TimelineBuffer();
    buffer.addJoin(at("10:00:00"));
    const failing = writer({
      incrementTimeline: vi.fn(async () => Promise.reject(new Error("lost"))),
    });
    await expect(flushTimeline(buffer, failing, () => "b1")).rejects.toThrow("lost");
    expect(buffer.pending?.id).toBe("b1");

    buffer.addLeave(at("11:00:00"));
    const w = writer();
    await flushTimeline(buffer, w, () => "b2");
    expect(w.incrementTimeline.mock.calls.map(([b]) => b.id)).toEqual(["b1", "b2"]);
    expect(w.incrementTimeline.mock.calls[1][0].flow).toEqual([
      { day: "2026-10-17", joins: 0, leaves: 1 },
    ]);
    expect(buffer.isEmpty).toBe(true);
  });
});
