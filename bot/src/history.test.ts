import { describe, expect, it } from "vitest";
import {
  backfillChannel,
  firstLiveCount,
  snowflakeAt,
  type Cursor,
  type HistoryIo,
  type HistoryMessage,
  type Page,
} from "./history.js";

const GUILD = "g1";
const general = { channel_id: "c1", name: "general" };
const alice = { user_id: "a", display_name: "Alice", avatar_url: null };
const bob = { user_id: "b", display_name: "Bob", avatar_url: null };
const cutoff = new Date("2026-10-10T12:00:00Z");

function message(id: number, author = alice, extra: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    id: String(id),
    createdAt: new Date(Date.UTC(2026, 9, 1 + (id % 5), id % 24)),
    guildId: GUILD,
    authorIsBot: false,
    webhookId: null,
    system: false,
    author,
    ...extra,
  };
}

/** A channel's history plus an in-memory backfill_page: compare-and-set cursor, summed counts. */
function fakeChannel(history: HistoryMessage[], cursor: Cursor) {
  const stored = { ...cursor };
  const counts = new Map<string, number>();
  const hours = new Map<string, number>();
  let failOnWrite = -1;
  let writes = 0;
  const io: HistoryIo = {
    async fetchBefore(before, limit) {
      return history
        .filter((m) => BigInt(m.id) < BigInt(before))
        .sort((x, y) => Number(BigInt(y.id) - BigInt(x.id)))
        .slice(0, limit);
    },
    async writePage(page: Page) {
      if (writes++ === failOnWrite) throw new Error("connection reset");
      if (stored.done || stored.beforeId !== page.beforeId) return false;
      stored.beforeId = page.nextBeforeId;
      stored.done = page.done;
      for (const c of page.counts) counts.set(`${c.user_id}:${c.day}`, (counts.get(`${c.user_id}:${c.day}`) ?? 0) + c.count);
      for (const c of page.channelCounts) hours.set(c.hour, (hours.get(c.hour) ?? 0) + c.count);
      return true;
    },
  };
  const total = () => [...counts.values()].reduce((n, c) => n + c, 0);
  return { io, stored, counts, hours, total, failOn: (n: number) => ((failOnWrite = n), (writes = 0)) };
}

const history = Array.from({ length: 25 }, (_, i) => message(i + 1, i % 2 ? bob : alice));

describe("snowflakeAt", () => {
  it("matches Discord's id layout", () => {
    // 175928847299117063 is the example from Discord's docs, sent at 1462015105796 ms.
    const at = snowflakeAt(new Date(1462015105796));
    expect(BigInt(at) >> 22n).toBe(BigInt("175928847299117063") >> 22n);
    expect(BigInt(at) <= BigInt("175928847299117063")).toBe(true);
  });

  it("is above every id from an earlier millisecond", () => {
    expect(BigInt(snowflakeAt(new Date(1462015105797)))).toBeGreaterThan(BigInt("175928847299117063"));
  });
});

describe("firstLiveCount", () => {
  const now = new Date("2026-10-17T00:00:00Z");

  it("uses the first hour when it falls on the first day", () => {
    expect(firstLiveCount("2026-10-10", "2026-10-10T12:00:00+00:00", now)).toEqual(cutoff);
  });

  it("falls back to the start of the first day when hourly counts began later", () => {
    expect(firstLiveCount("2026-10-08", "2026-10-10T12:00:00+00:00", now)).toEqual(
      new Date("2026-10-08T00:00:00Z"),
    );
    expect(firstLiveCount("2026-10-08", null, now)).toEqual(new Date("2026-10-08T00:00:00Z"));
  });

  it("is now when nothing was counted yet", () => {
    expect(firstLiveCount(null, null, now)).toEqual(now);
  });
});

describe("backfillChannel", () => {
  const start = (): Cursor => ({ beforeId: "1000", done: false });

  it("counts every message before the cursor, page by page", async () => {
    const ch = fakeChannel(history, start());
    expect(await backfillChannel(general, start(), GUILD, ch.io, 10)).toBe(25);
    expect(ch.total()).toBe(25);
    expect([...ch.hours.values()].reduce((n, c) => n + c, 0)).toBe(25);
    expect(ch.stored).toEqual({ beforeId: "1", done: true });
  });

  it("skips messages at or after the cursor", async () => {
    const ch = fakeChannel(history, { beforeId: "11", done: false });
    expect(await backfillChannel(general, { beforeId: "11", done: false }, GUILD, ch.io, 10)).toBe(10);
  });

  it("does not count bots, webhooks or system messages", async () => {
    const mixed = [
      message(1),
      message(2, bob, { authorIsBot: true }),
      message(3, bob, { webhookId: "w" }),
      message(4, bob, { system: true }),
    ];
    const ch = fakeChannel(mixed, start());
    expect(await backfillChannel(general, start(), GUILD, ch.io, 10)).toBe(1);
    expect([...ch.counts.keys()]).toEqual([`a:${mixed[0].createdAt.toISOString().slice(0, 10)}`]);
  });

  it("finishes an empty channel", async () => {
    const ch = fakeChannel([], start());
    expect(await backfillChannel(general, start(), GUILD, ch.io, 10)).toBe(0);
    expect(ch.stored).toEqual({ beforeId: "1000", done: true });
  });

  it("finishes when the last page is exactly full", async () => {
    const ch = fakeChannel(history.slice(0, 20), start());
    expect(await backfillChannel(general, start(), GUILD, ch.io, 10)).toBe(20);
    expect(ch.stored.done).toBe(true);
  });

  it("resumes after a crash from the stored cursor without double counting", async () => {
    const ch = fakeChannel(history, start());
    ch.failOn(1);
    await expect(backfillChannel(general, start(), GUILD, ch.io, 10)).rejects.toThrow("connection reset");
    expect(ch.total()).toBe(10);
    await backfillChannel(general, { ...ch.stored }, GUILD, ch.io, 10);
    expect(ch.total()).toBe(25);
  });

  it("adds nothing when run twice", async () => {
    const ch = fakeChannel(history, start());
    await backfillChannel(general, start(), GUILD, ch.io, 10);
    const counts = new Map(ch.counts);
    expect(await backfillChannel(general, { ...ch.stored }, GUILD, ch.io, 10)).toBe(0);
    // A rerun that read a stale cursor is rejected by the compare-and-set.
    expect(await backfillChannel(general, start(), GUILD, ch.io, 10)).toBe(0);
    expect(ch.counts).toEqual(counts);
  });
});
