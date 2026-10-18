import { describe, expect, it, vi } from "vitest";
import {
  ActivityBuffer,
  channelRow,
  displayName,
  flushActivity,
  memberRow,
  shouldCount,
  utcDay,
  utcHour,
  type ActivityWriter,
  type CountBatch,
} from "./activity.js";

const GUILD = "g1";
const human = { guildId: GUILD, authorIsBot: false, webhookId: null, system: false };
const alice = { user_id: "a", display_name: "Alice", avatar_url: "https://cdn/a.png" };
const general = { channel_id: "c1", name: "general" };
const empty = { members: [], channels: [], counts: [], channelCounts: [], memberChannelCounts: [] };

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

describe("utcHour", () => {
  it("truncates to the start of the hour", () => {
    expect(utcHour(new Date("2026-10-17T10:00:00.000Z"))).toBe("2026-10-17T10:00:00.000Z");
    expect(utcHour(new Date("2026-10-17T10:59:59.999Z"))).toBe("2026-10-17T10:00:00.000Z");
    expect(utcHour(new Date("2026-10-17T11:00:00.000Z"))).toBe("2026-10-17T11:00:00.000Z");
  });

  it("uses the UTC hour, not the local one", () => {
    expect(utcHour(new Date("2026-10-17T10:30:00+05:30"))).toBe("2026-10-17T05:00:00.000Z");
  });

  it("puts the last second of Sunday and the first of Monday (UTC) in different days", () => {
    // 2026-10-18 is a Sunday.
    const sunday = utcHour(new Date("2026-10-18T23:59:59.999Z"));
    const monday = utcHour(new Date("2026-10-19T00:00:00.000Z"));
    expect(sunday).toBe("2026-10-18T23:00:00.000Z");
    expect(monday).toBe("2026-10-19T00:00:00.000Z");
    expect(new Date(sunday).getUTCDay()).toBe(0);
    expect(new Date(monday).getUTCDay()).toBe(1);
  });

  it("takes the UTC weekday when the local one differs", () => {
    // Monday 01:30 in Brussels (summer time) is still Sunday in UTC.
    const hour = utcHour(new Date("2026-10-19T01:30:00+02:00"));
    expect(hour).toBe("2026-10-18T23:00:00.000Z");
    expect(new Date(hour).getUTCDay()).toBe(0);
  });

  it("rolls over month and year boundaries", () => {
    expect(utcHour(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31T23:00:00.000Z");
    expect(utcHour(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("channelRow", () => {
  it("uses the channel itself", () => {
    expect(channelRow({ id: "c1", name: "general" })).toEqual(general);
  });

  it("counts a thread toward its parent channel", () => {
    expect(
      channelRow({ id: "t1", name: "some thread", parent: { id: "c1", name: "general" } }),
    ).toEqual(general);
  });

  it("falls back to the thread when its parent is unknown", () => {
    expect(channelRow({ id: "t1", name: "some thread", parent: null })).toEqual({
      channel_id: "t1",
      name: "some thread",
    });
  });
});

describe("displayName", () => {
  it("prefers nickname, then global name, then username", () => {
    expect(displayName({ nickname: "Nick", globalName: "Global", username: "user" })).toBe("Nick");
    expect(displayName({ nickname: null, globalName: "Global", username: "user" })).toBe("Global");
    expect(displayName({ nickname: null, globalName: null, username: "user" })).toBe("user");
  });
});

describe("memberRow", () => {
  const user = {
    id: "a",
    username: "alice",
    globalName: "Alice",
    displayAvatarURL: () => "https://cdn/global.png",
  };

  it("picks up a global name and avatar change when there is no nickname or guild avatar", () => {
    const member = { nickname: null, displayAvatarURL: () => "https://cdn/global2.png" };
    expect(memberRow({ ...user, globalName: "Alice 2" }, member)).toEqual({
      user_id: "a",
      display_name: "Alice 2",
      avatar_url: "https://cdn/global2.png",
    });
  });

  it("keeps the nickname and guild avatar over a changed global profile", () => {
    const member = { nickname: "Ally", displayAvatarURL: () => "https://cdn/guild.png" };
    expect(memberRow({ ...user, globalName: "Alice 2" }, member)).toEqual({
      user_id: "a",
      display_name: "Ally",
      avatar_url: "https://cdn/guild.png",
    });
  });

  it("falls back to the user when the member is unknown", () => {
    expect(memberRow(user, null)).toEqual({
      user_id: "a",
      display_name: "Alice",
      avatar_url: "https://cdn/global.png",
    });
  });
});

describe("ActivityBuffer", () => {
  it("aggregates a burst into one row per member per UTC day", () => {
    const buf = new ActivityBuffer();
    for (let i = 0; i < 50; i++) buf.addMessage("a", "c1", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("a", "c1", new Date("2026-10-18T00:00:01Z"));
    buf.addMessage("b", "c1", new Date("2026-10-17T23:59:59Z"));
    expect(buf.drain().counts).toEqual([
      { user_id: "a", day: "2026-10-17", count: 50 },
      { user_id: "a", day: "2026-10-18", count: 1 },
      { user_id: "b", day: "2026-10-17", count: 1 },
    ]);
  });

  it("aggregates into one row per channel per UTC hour, whoever posts", () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("b", "c1", new Date("2026-10-17T10:59:59Z"));
    buf.addMessage("a", "c1", new Date("2026-10-17T11:00:00Z"));
    buf.addMessage("a", "c2", new Date("2026-10-17T10:30:00Z"));
    expect(buf.drain().channelCounts).toEqual([
      { channel_id: "c1", hour: "2026-10-17T10:00:00.000Z", count: 2 },
      { channel_id: "c1", hour: "2026-10-17T11:00:00.000Z", count: 1 },
      { channel_id: "c2", hour: "2026-10-17T10:00:00.000Z", count: 1 },
    ]);
  });

  it("aggregates into one row per member per channel per UTC day", () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("a", "c1", new Date("2026-10-17T23:59:59Z"));
    buf.addMessage("a", "c2", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("b", "c1", new Date("2026-10-17T10:00:00Z"));
    buf.addMessage("a", "c1", new Date("2026-10-18T00:00:00Z"));
    expect(buf.drain().memberChannelCounts).toEqual([
      { user_id: "a", channel_id: "c1", day: "2026-10-17", count: 2 },
      { user_id: "a", channel_id: "c2", day: "2026-10-17", count: 1 },
      { user_id: "b", channel_id: "c1", day: "2026-10-17", count: 1 },
      { user_id: "a", channel_id: "c1", day: "2026-10-18", count: 1 },
    ]);
  });

  it("keeps the latest channel name", () => {
    const buf = new ActivityBuffer();
    buf.setChannel(general);
    buf.setChannel({ ...general, name: "chat" });
    expect(buf.drain().channels).toEqual([{ ...general, name: "chat" }]);
  });

  it("keeps the latest member snapshot", () => {
    const buf = new ActivityBuffer();
    buf.setMember(alice);
    buf.setMember({ ...alice, display_name: "Alice 2" });
    expect(buf.drain().members).toEqual([{ ...alice, display_name: "Alice 2" }]);
  });

  it("is empty after a drain", () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", new Date());
    buf.setMember(alice);
    buf.setChannel(general);
    buf.drain();
    expect(buf.isEmpty).toBe(true);
    expect(buf.drain()).toEqual(empty);
  });

  it("restores a failed batch on top of newer activity", () => {
    const buf = new ActivityBuffer();
    const day = new Date("2026-10-17T10:00:00Z");
    buf.addMessage("a", "c1", day);
    buf.addMessage("a", "c1", day);
    buf.setMember(alice);
    buf.setChannel(general);
    const failed = buf.drain();

    buf.addMessage("a", "c1", day);
    buf.setMember({ ...alice, display_name: "Newer" });
    buf.setChannel({ ...general, name: "chat" });
    buf.restore(failed);

    expect(buf.drain()).toEqual({
      members: [{ ...alice, display_name: "Newer" }],
      channels: [{ ...general, name: "chat" }],
      counts: [{ user_id: "a", day: "2026-10-17", count: 3 }],
      channelCounts: [{ channel_id: "c1", hour: "2026-10-17T10:00:00.000Z", count: 3 }],
      memberChannelCounts: [{ user_id: "a", channel_id: "c1", day: "2026-10-17", count: 3 }],
    });
  });
});

function writer(overrides: Partial<ActivityWriter> = {}): ActivityWriter {
  return {
    upsertMembers: vi.fn(async () => {}),
    upsertChannels: vi.fn(async () => {}),
    incrementCounts: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("flushActivity", () => {
  const day = new Date("2026-10-17T10:00:00Z");

  it("writes members and channels before counts and empties the buffer", async () => {
    const order: string[] = [];
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", day);
    buf.setMember(alice);
    buf.setChannel(general);
    await flushActivity(
      buf,
      writer({
        upsertMembers: async (rows) => void order.push(`members:${rows.length}`),
        upsertChannels: async (rows) => void order.push(`channels:${rows.length}`),
        incrementCounts: async (batch) =>
          void order.push(`counts:${batch.counts.length}+${batch.channelCounts.length}`),
      }),
    );
    expect(order).toEqual(["members:1", "channels:1", "counts:1+1"]);
    expect(buf.isEmpty).toBe(true);
  });

  it("does nothing when there is nothing buffered", async () => {
    const w = writer();
    await flushActivity(new ActivityBuffer(), w);
    expect(w.upsertMembers).not.toHaveBeenCalled();
    expect(w.upsertChannels).not.toHaveBeenCalled();
    expect(w.incrementCounts).not.toHaveBeenCalled();
  });

  it.each([
    ["members", { upsertMembers: async () => Promise.reject(new Error("down")) }],
    ["channels", { upsertChannels: async () => Promise.reject(new Error("down")) }],
  ])("keeps everything when the %s write fails", async (_label, overrides) => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", day);
    buf.setMember(alice);
    buf.setChannel(general);
    const w = writer(overrides);
    await expect(flushActivity(buf, w)).rejects.toThrow("down");
    expect(w.incrementCounts).not.toHaveBeenCalled();
    expect(buf.drain()).toEqual({
      members: [alice],
      channels: [general],
      counts: [{ user_id: "a", day: "2026-10-17", count: 1 }],
      channelCounts: [{ channel_id: "c1", hour: "2026-10-17T10:00:00.000Z", count: 1 }],
      memberChannelCounts: [{ user_id: "a", channel_id: "c1", day: "2026-10-17", count: 1 }],
    });
  });

  it("keeps a failed counts batch as pending, under its id", async () => {
    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", day);
    buf.setMember(alice);
    const w = writer({ incrementCounts: async () => Promise.reject(new Error("down")) });
    await expect(flushActivity(buf, w, () => "b1")).rejects.toThrow("down");
    expect(buf.pending).toEqual({
      id: "b1",
      counts: [{ user_id: "a", day: "2026-10-17", count: 1 }],
      channelCounts: [{ channel_id: "c1", hour: "2026-10-17T10:00:00.000Z", count: 1 }],
      memberChannelCounts: [{ user_id: "a", channel_id: "c1", day: "2026-10-17", count: 1 }],
    });
    expect(buf.drain()).toEqual(empty);
  });

  it("counts once when a committed write loses its response and is retried", async () => {
    // Stands in for increment_message_counts: applies each batch id at most once.
    const applied = new Set<string>();
    const total = new Map<string, number>();
    let loseResponse = true;
    const sent: CountBatch[] = [];
    const w = writer({
      incrementCounts: async (batch) => {
        sent.push(batch);
        if (!applied.has(batch.id)) {
          applied.add(batch.id);
          for (const c of batch.counts) total.set(c.user_id, (total.get(c.user_id) ?? 0) + c.count);
        }
        if (loseResponse) {
          loseResponse = false;
          throw new Error("connection reset");
        }
      },
    });
    const ids = ["b1", "b2"];
    const newId = () => ids.shift()!;

    const buf = new ActivityBuffer();
    buf.addMessage("a", "c1", day);
    buf.addMessage("a", "c1", day);
    await expect(flushActivity(buf, w, newId)).rejects.toThrow("connection reset");

    buf.addMessage("a", "c1", day);
    await flushActivity(buf, w, newId);

    expect(sent.map((b) => b.id)).toEqual(["b1", "b1", "b2"]);
    expect(total.get("a")).toBe(3);
    expect(buf.isEmpty).toBe(true);
  });

  it("keeps new counts unsent while a pending batch still fails", async () => {
    const buf = new ActivityBuffer();
    buf.pending = {
      id: "b1",
      counts: [{ user_id: "a", day: "2026-10-17", count: 2 }],
      channelCounts: [{ channel_id: "c1", hour: "2026-10-17T10:00:00.000Z", count: 2 }],
      memberChannelCounts: [{ user_id: "a", channel_id: "c1", day: "2026-10-17", count: 2 }],
    };
    buf.addMessage("a", "c1", day);
    const sent: string[] = [];
    const w = writer({
      incrementCounts: async (batch) => {
        sent.push(batch.id);
        throw new Error("down");
      },
    });
    await expect(flushActivity(buf, w, () => "b2")).rejects.toThrow("down");
    expect(sent).toEqual(["b1"]);
    expect(buf.pending?.id).toBe("b1");
    expect(buf.drain().counts).toEqual([{ user_id: "a", day: "2026-10-17", count: 1 }]);
  });
});
