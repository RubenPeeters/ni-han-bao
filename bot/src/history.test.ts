import { describe, expect, it } from "vitest";
import { backfillBefore, backfillChannel, countsLive, snowflakeAt, snowflakeTime, type Cursor, type HistoryIo, type HistoryMessage, type Page } from "./history.js";

const GUILD = "g1";
const CHANNEL = { channel_id: "c1", name: "general" };

function msg(id: number, user = "u1", extra: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    id: String(id),
    // Ten minutes per id, so a page spans several hours.
    createdAt: new Date(Date.UTC(2026, 9, 1) + id * 10 * 60_000),
    guildId: GUILD,
    authorIsBot: false,
    webhookId: null,
    system: false,
    author: { user_id: user, display_name: user, avatar_url: null },
    ...extra,
  };
}

/** A channel's history plus a fake database that applies pages like backfill_page does. */
function world(history: HistoryMessage[], start: string) {
  const db = { cursor: { beforeId: start, done: false } as Cursor, totals: new Map<string, number>(), pages: 0 };
  let failAfter = Infinity;
  const io: HistoryIo = {
    async fetchBefore(beforeId, limit) {
      if (db.pages >= failAfter) throw new Error("connection lost");
      return history
        .filter((m) => BigInt(m.id) < BigInt(beforeId))
        .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)))
        .slice(0, limit);
    },
    async writePage(page: Page) {
      if (db.cursor.done || db.cursor.beforeId !== page.beforeId) return false;
      db.cursor = { beforeId: page.nextBeforeId, done: page.done };
      for (const c of page.counts) db.totals.set(`${c.user_id}:${c.day}`, (db.totals.get(`${c.user_id}:${c.day}`) ?? 0) + c.count);
      for (const c of page.channelCounts) {
        db.totals.set(`${c.channel_id}@${c.hour}`, (db.totals.get(`${c.channel_id}@${c.hour}`) ?? 0) + c.count);
      }
      db.pages++;
      return true;
    },
  };
  return { db, io, failAfterPages: (n: number) => (failAfter = n) };
}

const history = Array.from({ length: 25 }, (_, i) => msg(i + 1, i % 2 ? "u1" : "u2"));

describe("backfillChannel", () => {
  it("counts every page older than the cursor, member per day and channel per hour", async () => {
    const { db, io } = world([...history, msg(30)], "26");
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io, 10)).toBe(25);
    expect(db.cursor).toEqual({ beforeId: "1", done: true });
    expect(db.totals.get("u1:2026-10-01")).toBe(12);
    expect(db.totals.get("u2:2026-10-01")).toBe(13);
    // Ids 1-5 fall in 00:00, 6-11 in 01:00 (ten minutes each).
    expect(db.totals.get("c1@2026-10-01T00:00:00.000Z")).toBe(5);
    expect(db.totals.get("c1@2026-10-01T01:00:00.000Z")).toBe(6);
  });

  it("leaves out bots, webhooks and system messages but still moves past them", async () => {
    const { db, io } = world(
      [msg(1), msg(2, "bot", { authorIsBot: true }), msg(3, "hook", { webhookId: "w" }), msg(4, "u1", { system: true })],
      "5",
    );
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io)).toBe(1);
    expect(db.cursor).toEqual({ beforeId: "1", done: true });
  });

  it("resumes after a crash without counting any page twice", async () => {
    const { db, io, failAfterPages } = world(history, "26");
    failAfterPages(1);
    await expect(backfillChannel(CHANNEL, db.cursor, GUILD, io, 10)).rejects.toThrow("connection lost");
    expect(db.cursor).toEqual({ beforeId: "16", done: false });
    failAfterPages(Infinity);
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io, 10)).toBe(15);
    expect(db.totals.get("u1:2026-10-01")! + db.totals.get("u2:2026-10-01")!).toBe(25);
  });

  it("adds nothing when run again on a finished channel", async () => {
    const { db, io } = world(history, "26");
    await backfillChannel(CHANNEL, db.cursor, GUILD, io, 10);
    const before = new Map(db.totals);
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io, 10)).toBe(0);
    expect(db.totals).toEqual(before);
  });

  it("stops when a stale cursor's page is refused, so a second run cannot double count", async () => {
    const { db, io } = world(history, "26");
    const stale = { ...db.cursor };
    await backfillChannel(CHANNEL, db.cursor, GUILD, io, 10);
    const before = new Map(db.totals);
    expect(await backfillChannel(CHANNEL, stale, GUILD, io, 10)).toBe(0);
    expect(db.totals).toEqual(before);
  });

  it("finishes an empty channel with one empty page", async () => {
    const { db, io } = world([], "26");
    expect(await backfillChannel(CHANNEL, db.cursor, GUILD, io)).toBe(0);
    expect(db.cursor).toEqual({ beforeId: "26", done: true });
  });
});

describe("snowflakeAt", () => {
  it("is above every id from an earlier millisecond and at most any id from that one", () => {
    const at = new Date("2026-10-17T13:00:00.000Z");
    const ms = BigInt(at.getTime()) - 1420070400000n;
    expect(BigInt(snowflakeAt(at))).toBe(ms << 22n);
    expect(((ms - 1n) << 22n) | 0x3fffffn).toBeLessThan(BigInt(snowflakeAt(at)));
  });
});

describe("backfillBefore", () => {
  const now = new Date("2026-10-18T09:41:00.000Z");

  it("starts at the first live hour", () => {
    expect(backfillBefore("2026-10-17", "2026-10-17T13:00:00+00:00", now)).toBe(snowflakeAt(new Date("2026-10-17T13:00:00Z")));
  });

  it("starts at the next hour when nothing was counted live yet, so the first live hour is whole", () => {
    expect(backfillBefore(null, null, now)).toBe(snowflakeAt(new Date("2026-10-18T10:00:00Z")));
    expect(backfillBefore(null, null, new Date("2026-12-31T23:59:59.999Z"))).toBe(snowflakeAt(new Date("2027-01-01T00:00:00Z")));
  });

  it("starts at the first live day when member counts are older than any channel count", () => {
    expect(backfillBefore("2026-10-16", "2026-10-17T13:00:00+00:00", now)).toBe(snowflakeAt(new Date("2026-10-16T00:00:00Z")));
    expect(backfillBefore("2026-10-16", null, now)).toBe(snowflakeAt(new Date("2026-10-16T00:00:00Z")));
  });
});

describe("countsLive", () => {
  const boundary = snowflakeAt(new Date("2026-10-18T10:00:00Z"));

  it("leaves messages before the boundary to the backfill and counts the rest live", () => {
    const early = (BigInt(snowflakeAt(new Date("2026-10-18T09:37:00Z"))) | 0x3fffffn).toString();
    expect(countsLive(early, boundary)).toBe(false);
    expect(countsLive((BigInt(boundary) - 1n).toString(), boundary)).toBe(false);
    expect(countsLive(boundary, boundary)).toBe(true);
    expect(countsLive(snowflakeAt(new Date("2026-10-18T10:00:01Z")), boundary)).toBe(true);
  });

  it("splits at the time snowflakeTime reads back", () => {
    expect(snowflakeTime(boundary)).toEqual(new Date("2026-10-18T10:00:00Z"));
  });
});
