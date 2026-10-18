import { describe, expect, it } from "vitest";
import { flushServers, Server, type ServerWriter } from "./servers.js";

const alice = { user_id: "a", display_name: "Alice", avatar_url: null };
const at = new Date("2026-10-19T10:15:00Z");

/** Records every write per guild; guilds in `failing` reject their count writes. */
function recorder(failing: string[] = []) {
  const writes: Record<string, { counts: unknown[]; members: string[] }> = {};
  const writerFor = (guildId: string): ServerWriter => {
    const w = (writes[guildId] ??= { counts: [], members: [] });
    const fail = () => {
      if (failing.includes(guildId)) throw new Error(`down: ${guildId}`);
    };
    return {
      async upsertMembers(rows) {
        w.members.push(...rows.map((r) => r.user_id));
      },
      async upsertChannels() {},
      async incrementCounts(batch) {
        fail();
        w.counts.push(...batch.counts);
      },
      async incrementReactions(batch) {
        fail();
        w.counts.push(...batch.receivedCounts);
      },
      async incrementTimeline(batch) {
        fail();
        w.counts.push(...batch.voice);
      },
    };
  };
  return { writes, writerFor };
}

describe("flushServers", () => {
  it("keeps the same user's counts separate per server", async () => {
    const one = new Server("g1", "0");
    const two = new Server("g2", "0");
    one.activity.addMessage("a", "c1", at);
    one.activity.addMessage("a", "c1", at);
    one.activity.setMember(alice);
    two.activity.addMessage("a", "c9", at);
    two.activity.setMember(alice);
    const { writes, writerFor } = recorder();

    expect(await flushServers([one, two], writerFor, () => {}, at)).toBe(true);

    expect(writes.g1.counts).toEqual([{ user_id: "a", day: "2026-10-19", count: 2 }]);
    expect(writes.g2.counts).toEqual([{ user_id: "a", day: "2026-10-19", count: 1 }]);
    expect(writes.g1.members).toEqual(["a"]);
    expect(writes.g2.members).toEqual(["a"]);
  });

  it("writes voice time to the server it was spent in", async () => {
    const one = new Server("g1", "0");
    const two = new Server("g2", "0");
    one.voice.update("a", true, new Date("2026-10-19T10:00:00Z"));
    const { writes, writerFor } = recorder();

    await flushServers([one, two], writerFor, () => {}, at);

    expect(writes.g1.counts).toEqual([{ user_id: "a", day: "2026-10-19", seconds: 900 }]);
    expect(writes.g2.counts).toEqual([]);
  });

  it("still flushes the other servers when one fails, and keeps the failed counts", async () => {
    const one = new Server("g1", "0");
    const two = new Server("g2", "0");
    one.activity.addMessage("a", "c1", at);
    two.activity.addMessage("a", "c1", at);
    const errors: string[] = [];
    const { writes, writerFor } = recorder(["g1"]);

    const ok = await flushServers([one, two], writerFor, (guild, stream) => errors.push(`${guild}:${stream}`), at);

    expect(ok).toBe(false);
    expect(errors).toEqual(["g1:activity"]);
    expect(writes.g2.counts).toHaveLength(1);
    expect(one.activity.pending?.counts).toEqual([{ user_id: "a", day: "2026-10-19", count: 1 }]);
  });
});
