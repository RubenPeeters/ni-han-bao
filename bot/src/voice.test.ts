import { describe, expect, it } from "vitest";
import { splitByUtcDay, VoiceTracker, type VoiceSecondsRow } from "./voice.js";

const t = (iso: string) => new Date(iso);

/** Seconds per user:day, summed, so tests do not depend on how time was cut up. */
function totals(rows: VoiceSecondsRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.user_id}:${r.day}`] = (out[`${r.user_id}:${r.day}`] ?? 0) + r.seconds;
  return out;
}

describe("splitByUtcDay", () => {
  it("keeps a stretch within one day whole", () => {
    expect(splitByUtcDay("a", t("2026-10-17T10:00:00Z"), t("2026-10-17T11:30:00Z"))).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 5400 },
    ]);
  });

  it("splits at UTC midnight", () => {
    expect(splitByUtcDay("a", t("2026-10-17T23:50:00Z"), t("2026-10-18T00:15:00Z"))).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 600 },
      { user_id: "a", day: "2026-10-18", seconds: 900 },
    ]);
  });

  it("fills whole days in between", () => {
    const rows = splitByUtcDay("a", t("2026-10-17T12:00:00Z"), t("2026-10-19T06:00:00Z"));
    expect(rows.map((r) => [r.day, r.seconds])).toEqual([
      ["2026-10-17", 43200],
      ["2026-10-18", 86400],
      ["2026-10-19", 21600],
    ]);
  });

  it("returns nothing for an empty or backwards stretch", () => {
    expect(splitByUtcDay("a", t("2026-10-17T10:00:00Z"), t("2026-10-17T10:00:00Z"))).toEqual([]);
    expect(splitByUtcDay("a", t("2026-10-17T10:00:00Z"), t("2026-10-17T09:00:00Z"))).toEqual([]);
  });

  it("does not drift when a stretch is cut at odd milliseconds", () => {
    const cuts = ["10:00:00.700", "10:00:01.200", "10:00:01.900", "10:00:09.300", "10:00:10.700"];
    const rows = cuts
      .slice(1)
      .flatMap((c, i) => splitByUtcDay("a", t(`2026-10-17T${cuts[i]}Z`), t(`2026-10-17T${c}Z`)));
    const whole = splitByUtcDay("a", t(`2026-10-17T${cuts[0]}Z`), t(`2026-10-17T${cuts.at(-1)}Z`));
    expect(totals(rows)).toEqual(totals(whole));
    expect(totals(rows)).toEqual({ "a:2026-10-17": 10 });
  });
});

describe("VoiceTracker", () => {
  it("counts a session from join to leave", () => {
    const v = new VoiceTracker();
    expect(v.update("a", "vc1", t("2026-10-17T20:00:00Z"))).toEqual([]);
    expect(v.isOpen("a")).toBe(true);
    expect(v.update("a", null, t("2026-10-17T20:45:00Z"))).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 2700 },
    ]);
    expect(v.isOpen("a")).toBe(false);
  });

  it("keeps the session going through channel moves", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
    expect(v.update("a", "vc2", t("2026-10-17T20:10:00Z"))).toEqual([]);
    expect(v.update("a", "vc3", t("2026-10-17T20:20:00Z"))).toEqual([]);
    expect(v.update("a", null, t("2026-10-17T20:30:00Z"))).toEqual([
      { user_id: "a", day: "2026-10-17", seconds: 1800 },
    ]);
  });

  it("treats other state changes in the same channel (mute, stream) as no change", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
    v.update("a", "vc1", t("2026-10-17T20:05:00Z"));
    expect(totals(v.update("a", null, t("2026-10-17T20:10:00Z")))).toEqual({ "a:2026-10-17": 600 });
  });

  it("ignores a leave without a join", () => {
    const v = new VoiceTracker();
    expect(v.update("a", null, t("2026-10-17T20:00:00Z"))).toEqual([]);
  });

  it("tracks members separately", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
    v.update("b", "vc1", t("2026-10-17T20:30:00Z"));
    const rows = [
      ...v.update("a", null, t("2026-10-17T21:00:00Z")),
      ...v.update("b", null, t("2026-10-17T21:00:00Z")),
    ];
    expect(totals(rows)).toEqual({ "a:2026-10-17": 3600, "b:2026-10-17": 1800 });
  });

  it("accrues open sessions without closing them or counting twice", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
    const rows = [
      ...v.accrue(t("2026-10-17T20:10:00Z")),
      ...v.accrue(t("2026-10-17T20:25:00Z")),
      ...v.update("a", null, t("2026-10-17T20:30:00Z")),
    ];
    expect(totals(rows)).toEqual({ "a:2026-10-17": 1800 });
    expect(v.isOpen("a")).toBe(false);
  });

  it("splits a session across midnight into both days", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T23:30:00Z"));
    const rows = [...v.accrue(t("2026-10-17T23:59:00Z")), ...v.update("a", null, t("2026-10-18T00:20:00Z"))];
    expect(totals(rows)).toEqual({ "a:2026-10-17": 1800, "a:2026-10-18": 1200 });
  });

  it("does not count backwards when the clock steps back", () => {
    const v = new VoiceTracker();
    v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
    expect(v.accrue(t("2026-10-17T19:59:00Z"))).toEqual([]);
    expect(totals(v.update("a", null, t("2026-10-17T20:01:00Z")))).toEqual({ "a:2026-10-17": 60 });
  });

  describe("restart", () => {
    it("closes every session at shutdown, so none stays open", () => {
      const v = new VoiceTracker();
      v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
      v.update("b", "vc2", t("2026-10-17T20:30:00Z"));
      expect(totals(v.closeAll(t("2026-10-17T21:00:00Z")))).toEqual({
        "a:2026-10-17": 3600,
        "b:2026-10-17": 1800,
      });
      expect(v.isOpen("a") || v.isOpen("b")).toBe(false);
      expect(v.accrue(t("2026-10-18T21:00:00Z"))).toEqual([]);
    });

    it("starts counting people already in voice at startup, not before", () => {
      // A fresh tracker is a restarted bot: the downtime must not be counted.
      const v = new VoiceTracker();
      expect(v.sync(["a"], t("2026-10-17T22:00:00Z"))).toEqual([]);
      expect(totals(v.update("a", null, t("2026-10-17T22:05:00Z")))).toEqual({ "a:2026-10-17": 300 });
    });

    it("counts only up to shutdown and from startup when someone stays in voice", () => {
      const before = new VoiceTracker();
      before.update("a", "vc1", t("2026-10-17T20:00:00Z"));
      const rows = before.closeAll(t("2026-10-17T20:30:00Z"));

      const after = new VoiceTracker();
      rows.push(...after.sync(["a"], t("2026-10-17T21:30:00Z")));
      rows.push(...after.update("a", null, t("2026-10-17T21:40:00Z")));

      expect(totals(rows)).toEqual({ "a:2026-10-17": 1800 + 600 });
    });

    it("after a crash, loses at most the stretch since the last accrue", () => {
      const v = new VoiceTracker();
      v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
      const written = v.accrue(t("2026-10-17T20:10:00Z"));
      // The process dies here; nothing open was persisted, and a new tracker starts empty.
      expect(totals(written)).toEqual({ "a:2026-10-17": 600 });
      expect(new VoiceTracker().accrue(t("2026-10-18T20:00:00Z"))).toEqual([]);
    });
  });

  describe("sync", () => {
    it("closes a session whose leave was missed", () => {
      const v = new VoiceTracker();
      v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
      expect(totals(v.sync([], t("2026-10-17T20:20:00Z")))).toEqual({ "a:2026-10-17": 1200 });
      expect(v.isOpen("a")).toBe(false);
    });

    it("opens a session whose join was missed, from now", () => {
      const v = new VoiceTracker();
      v.sync(["a"], t("2026-10-17T20:00:00Z"));
      expect(v.isOpen("a")).toBe(true);
      expect(totals(v.sync(["a"], t("2026-10-17T20:01:00Z")))).toEqual({ "a:2026-10-17": 60 });
    });

    it("accrues sessions that are still open", () => {
      const v = new VoiceTracker();
      v.update("a", "vc1", t("2026-10-17T20:00:00Z"));
      const rows = [...v.sync(["a"], t("2026-10-17T20:10:00Z")), ...v.update("a", null, t("2026-10-17T20:15:00Z"))];
      expect(totals(rows)).toEqual({ "a:2026-10-17": 900 });
    });
  });
});
