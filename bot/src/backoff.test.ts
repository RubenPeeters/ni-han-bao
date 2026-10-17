import { describe, expect, it } from "vitest";
import { ActivityBuffer, flushActivity, type CountBatch } from "./activity.js";
import { Backoff, flushUntil, type Clock } from "./backoff.js";

/** Time only moves when the code under test sleeps. */
function fakeClock(start = 0): Clock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    async sleep(ms) {
      slept.push(ms);
      now += ms;
    },
  };
}

describe("Backoff", () => {
  it("doubles the delay per failure up to the cap", () => {
    const b = new Backoff(1000, 5000);
    expect([b.fail(0), b.fail(0), b.fail(0), b.fail(0)]).toEqual([1000, 2000, 4000, 5000]);
  });

  it("is not ready until the delay has passed", () => {
    const b = new Backoff(1000, 5000);
    expect(b.ready(0)).toBe(true);
    b.fail(0);
    expect(b.ready(999)).toBe(false);
    expect(b.ready(1000)).toBe(true);
  });

  it("starts over after a success", () => {
    const b = new Backoff(1000, 5000);
    b.fail(0);
    b.fail(0);
    b.succeed();
    expect(b.ready(0)).toBe(true);
    expect(b.failures).toBe(0);
    expect(b.fail(0)).toBe(1000);
  });
});

describe("flushUntil", () => {
  it("retries with backoff until the flush succeeds", async () => {
    const clock = fakeClock();
    const results = [false, false, true];
    const retries: [number, number][] = [];
    const ok = await flushUntil(
      async () => results.shift()!,
      10_000,
      new Backoff(500, 2000),
      clock,
      (attempt, delay) => retries.push([attempt, delay]),
    );
    expect(ok).toBe(true);
    expect(clock.slept).toEqual([500, 1000]);
    expect(retries).toEqual([
      [1, 500],
      [2, 1000],
    ]);
  });

  it("gives up rather than retry past the deadline", async () => {
    const clock = fakeClock();
    let calls = 0;
    const ok = await flushUntil(
      async () => {
        calls++;
        return false;
      },
      3000,
      new Backoff(500, 2000),
      clock,
    );
    expect(ok).toBe(false);
    // 500 + 1000 = 1500 slept; the next 2000 would end at 3500, past the deadline.
    expect(clock.slept).toEqual([500, 1000]);
    expect(calls).toBe(3);
    expect(clock.now()).toBeLessThanOrEqual(3000);
  });

  it("writes buffered counts on shutdown through a failing database", async () => {
    const buffer = new ActivityBuffer();
    buffer.addMessage("a", "c1", new Date("2026-10-17T10:00:00Z"));
    buffer.addMessage("a", "c1", new Date("2026-10-17T10:00:05Z"));
    const sent: CountBatch[] = [];
    let failures = 2;
    const writer = {
      async upsertMembers() {},
      async upsertChannels() {},
      async incrementCounts(batch: CountBatch) {
        if (failures-- > 0) throw new Error("network down");
        sent.push(batch);
      },
    };
    const ok = await flushUntil(
      () =>
        flushActivity(buffer, writer).then(
          () => true,
          () => false,
        ),
      8000,
      new Backoff(500, 2000),
      fakeClock(),
    );
    expect(ok).toBe(true);
    expect(buffer.isEmpty).toBe(true);
    // The failed batch is resent unchanged, so the counts arrive exactly once.
    expect(sent).toHaveLength(1);
    expect(sent[0].counts).toEqual([{ user_id: "a", day: "2026-10-17", count: 2 }]);
  });
});
