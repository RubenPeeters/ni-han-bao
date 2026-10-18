import { describe, expect, it } from "vitest";
import {
  backfillBefore,
  backfillBoundary,
  backfillChannel,
  must,
  mustWrite,
  snowflakeAt,
  type Cursor,
  type HistoryIo,
  type HistoryMessage,
  type Page,
} from "./history.js";

const GUILD = "g1";
const CHANNEL = { channel_id: "c1", name: "general" };
const BOUNDARY = new Date("2026-10-10T00:00:00Z");

function message(minutesBefore: number, userId: string, over: Partial<HistoryMessage> = {}): HistoryMessage {
  const createdAt = new Date(BOUNDARY.getTime() - minutesBefore * 60_000);
  return {
    id: (BigInt(snowflakeAt(createdAt)) + 1n).toString(),
    createdAt,
    guildId: GUILD,
    authorIsBot: false,
    webhookId: null,
    system: false,
    author: { user_id: userId, display_name: userId, avatar_url: null },
    ...over,
  };
}

/** A channel's history plus a database that applies pages the way backfill_page does. */
function fakeIo(history: HistoryMessage[]) {
  const db = {
    cursor: { channelId: "c1", beforeId: snowflakeAt(BOUNDARY), done: false } as Cursor,
    counts: new Map<string, number>(),
    channelCounts: new Map<string, number>(),
  };
  let failWritesAfter = Infinity;
  const io: HistoryIo = {
    async fetchBefore(beforeId, limit) {
      return history
        .filter((m) => BigInt(m.id) < BigInt(beforeId))
        .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
        .slice(0, limit);
    },
    async writePage(page: Page) {
      if (failWritesAfter-- <= 0) throw new Error("connection reset");
      if (db.cursor.beforeId !== page.beforeId || db.cursor.done) return false;
      db.cursor = { ...db.cursor, beforeId: page.nextBeforeId, done: page.done };
      for (const c of page.counts) {
        const key = `${c.user_id}:${c.day}`;
        db.counts.set(key, (db.counts.get(key) ?? 0) + c.count);
      }
      for (const c of page.channelCounts) {
        const key = `${c.channel_id}:${c.hour}`;
        db.channelCounts.set(key, (db.channelCounts.get(key) ?? 0) + c.count);
      }
      return true;
    },
  };
  return { db, io, failAfter: (n: number) => (failWritesAfter = n) };
}

// 7 messages over two days and two hours, plus ones that must not count.
const HISTORY = [
  message(1, "u1"),
  message(2, "u1"),
  message(3, "u2"),
  message(70, "u1"),
  message(60 * 24 + 1, "u1"),
  message(60 * 24 + 2, "u2"),
  message(60 * 24 + 3, "u2"),
  message(4, "bot", { authorIsBot: true }),
  message(5, "hook", { webhookId: "w1" }),
  message(6, "sys", { system: true }),
];

const EXPECTED_COUNTS = new Map([
  ["u1:2026-10-09", 3],
  ["u2:2026-10-09", 1],
  ["u1:2026-10-08", 1],
  ["u2:2026-10-08", 2],
]);
const EXPECTED_CHANNEL_COUNTS = new Map([
  ["c1:2026-10-09T23:00:00.000Z", 3],
  ["c1:2026-10-09T22:00:00.000Z", 1],
  ["c1:2026-10-08T23:00:00.000Z", 3],
]);

describe("backfillChannel", () => {
  it("counts every member message older than the cursor, per member-day and channel-hour", async () => {
    const { db, io } = fakeIo([...HISTORY, message(-1, "u1")]); // one live message after the boundary
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io, 3)).toBe(7);
    expect(db.counts).toEqual(EXPECTED_COUNTS);
    expect(db.channelCounts).toEqual(EXPECTED_CHANNEL_COUNTS);
    expect(db.cursor.done).toBe(true);
  });

  it("resumes after a crash without double counting", async () => {
    const { db, io, failAfter } = fakeIo(HISTORY);
    failAfter(2);
    await expect(backfillChannel(CHANNEL, db.cursor, GUILD, io, 3)).rejects.toThrow("connection reset");
    expect(db.cursor.done).toBe(false);
    failAfter(Infinity);
    await backfillChannel(CHANNEL, db.cursor, GUILD, io, 3);
    expect(db.counts).toEqual(EXPECTED_COUNTS);
    expect(db.channelCounts).toEqual(EXPECTED_CHANNEL_COUNTS);
  });

  it("adds nothing when run again after finishing", async () => {
    const { db, io } = fakeIo(HISTORY);
    await backfillChannel(CHANNEL, db.cursor, GUILD, io, 3);
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io, 3)).toBe(0);
    expect(db.counts).toEqual(EXPECTED_COUNTS);
  });

  it("stops without counting when its cursor is stale (another run moved it)", async () => {
    const { db, io } = fakeIo(HISTORY);
    const stale = { ...db.cursor };
    await backfillChannel(CHANNEL, db.cursor, GUILD, io, 3);
    expect(await backfillChannel(CHANNEL, stale, GUILD, io, 3)).toBe(0);
    expect(db.counts).toEqual(EXPECTED_COUNTS);
  });

  it("finishes an empty channel", async () => {
    const { db, io } = fakeIo([]);
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io)).toBe(0);
    expect(db.cursor.done).toBe(true);
  });
});

describe("backfillBoundary", () => {
  it("is the start of the first live hour, so earlier messages that day are still counted", () => {
    expect(backfillBoundary("2026-10-17", "2026-10-17T18:00:00+00:00", new Date("2026-10-18T12:00:00Z"))).toEqual(
      new Date("2026-10-17T18:00:00Z"),
    );
  });

  it("is the start of the first live day when member counts predate channel counts", () => {
    expect(backfillBoundary("2026-10-16", "2026-10-17T18:00:00+00:00", new Date("2026-10-18T12:00:00Z"))).toEqual(
      new Date("2026-10-16T00:00:00Z"),
    );
  });

  it("is the start of this hour when nothing was counted live yet", () => {
    expect(backfillBoundary(null, null, new Date("2026-10-18T12:34:00Z"))).toEqual(
      new Date("2026-10-18T12:00:00Z"),
    );
  });
});

describe("backfillBefore", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  // The live bot came up at 18:45, so 18:00-18:44 is history and 18:45 on was counted live.
  const firstCounted = snowflakeAt(new Date("2026-10-17T18:45:00Z"));
  const earlierThatHour = snowflakeAt(new Date("2026-10-17T18:10:00Z"));
  const counts = (before: string, id: string) => BigInt(id) < BigInt(before);

  it("stops at the first counted message, so earlier messages in its hour are still history", () => {
    const before = backfillBefore(null, firstCounted, "2026-10-17", "2026-10-17T18:00:00+00:00", now);
    expect(counts(before, earlierThatHour)).toBe(true);
    expect(counts(before, firstCounted)).toBe(false);
  });

  it("takes an exact start for a bot that never recorded one, as an id or a time", () => {
    expect(backfillBefore(firstCounted, null, "2026-10-17", "2026-10-17T18:00:00+00:00", now)).toBe(firstCounted);
    expect(backfillBefore("2026-10-17T18:45:00Z", null, "2026-10-17", "2026-10-17T18:00:00+00:00", now)).toBe(
      firstCounted,
    );
    expect(() => backfillBefore("yesterday", null, null, null, now)).toThrow();
  });

  it("ignores a first message recorded after the first live hour (an upgraded older bot)", () => {
    const late = snowflakeAt(new Date("2026-10-18T09:00:00Z"));
    expect(backfillBefore(null, late, "2026-10-17", "2026-10-17T18:00:00+00:00", now)).toBe(
      snowflakeAt(new Date("2026-10-17T18:00:00Z")),
    );
  });
});

describe("must / mustWrite", () => {
  it("accepts a successful write that returns no data", () => {
    expect(() => mustWrite("t", { data: null, error: null })).not.toThrow();
    expect(() => mustWrite("t", { data: null, error: { message: "boom" } })).toThrow("t: boom");
  });

  it("requires data from reads", () => {
    expect(must("t", { data: [1], error: null })).toEqual([1]);
    expect(() => must("t", { data: null, error: null })).toThrow("t: no data");
  });
});

describe("snowflakeAt", () => {
  it("matches Discord's id layout", () => {
    // Discord's documented example: 175928847299117063 was created at 2016-04-30T11:18:25.796Z.
    expect(BigInt(snowflakeAt(new Date("2016-04-30T11:18:25.796Z"))) >> 22n).toBe(175928847299117063n >> 22n);
  });
});
