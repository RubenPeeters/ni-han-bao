import { describe, expect, it, vi } from "vitest";
import {
  emojiRow,
  flushReactions,
  ReactionBuffer,
  receivesReaction,
  type ReactionBatch,
  type ReactionWriter,
} from "./reactions.js";

const GUILD = "g1";
const alice = { user_id: "a", display_name: "Alice", avatar_url: "https://cdn/a.png" };
const thumbs = { emoji_key: "👍", emoji_id: null, name: "👍", animated: false };
const pog = { emoji_key: "111", emoji_id: "111", name: "pog", animated: false };
const day = new Date("2026-10-17T10:00:00Z");

describe("emojiRow", () => {
  it("keys a unicode emoji by the emoji itself", () => {
    expect(emojiRow({ id: null, name: "👍", animated: null })).toEqual(thumbs);
  });

  it("keys a custom emoji by id and keeps its name", () => {
    expect(emojiRow({ id: "111", name: "pog", animated: true })).toEqual({ ...pog, animated: true });
  });

  it("keeps the same key when a custom emoji is renamed", () => {
    const before = emojiRow({ id: "111", name: "pog", animated: false });
    const after = emojiRow({ id: "111", name: "poggers", animated: false });
    expect(after?.emoji_key).toBe(before?.emoji_key);
    expect(after?.name).toBe("poggers");
  });

  it("does not confuse a custom emoji with a unicode one of the same name", () => {
    expect(emojiRow({ id: "111", name: "👍", animated: false })?.emoji_key).not.toBe(
      emojiRow({ id: null, name: "👍", animated: null })?.emoji_key,
    );
  });

  it("still counts a custom emoji Discord sent without a name", () => {
    expect(emojiRow({ id: "111", name: null, animated: null })).toEqual({ ...pog, name: null });
  });

  it("skips an emoji with neither id nor name", () => {
    expect(emojiRow({ id: null, name: null, animated: null })).toBeNull();
  });
});

describe("receivesReaction", () => {
  const author = { id: "a", guildId: GUILD, authorIsBot: false, webhookId: null, system: false };

  it("counts a reaction from someone else", () => {
    expect(receivesReaction(author, "b", GUILD)).toBe(true);
  });

  it.each([
    ["a self-reaction", author, "a"],
    ["a bot's message", { ...author, authorIsBot: true }, "b"],
    ["a webhook message", { ...author, webhookId: "w1" }, "b"],
    ["a system message", { ...author, system: true }, "b"],
    ["another guild", { ...author, guildId: "other" }, "b"],
  ])("ignores %s", (_label, message, reactor) => {
    expect(receivesReaction(message, reactor, GUILD)).toBe(false);
  });
});

describe("ReactionBuffer", () => {
  it("aggregates into one row per emoji per UTC day", () => {
    const buf = new ReactionBuffer();
    for (let i = 0; i < 3; i++) buf.addEmoji(thumbs, day);
    buf.addEmoji(thumbs, new Date("2026-10-18T00:00:01Z"));
    buf.addEmoji(pog, new Date("2026-10-17T23:59:59Z"));
    const drained = buf.drain();
    expect(drained.emojiCounts).toEqual([
      { emoji_key: "👍", day: "2026-10-17", count: 3 },
      { emoji_key: "👍", day: "2026-10-18", count: 1 },
      { emoji_key: "111", day: "2026-10-17", count: 1 },
    ]);
    expect(drained.emojis).toEqual([thumbs, pog]);
  });

  it("keeps the latest emoji name", () => {
    const buf = new ReactionBuffer();
    buf.addEmoji(pog, day);
    buf.addEmoji({ ...pog, name: "poggers" }, day);
    const drained = buf.drain();
    expect(drained.emojis).toEqual([{ ...pog, name: "poggers" }]);
    expect(drained.emojiCounts).toEqual([{ emoji_key: "111", day: "2026-10-17", count: 2 }]);
  });

  it("counts received reactions per author per UTC day, with the author's row", () => {
    const buf = new ReactionBuffer();
    buf.addReceived(alice, day);
    buf.addReceived({ ...alice, display_name: "Alice 2" }, day);
    const drained = buf.drain();
    expect(drained.receivedCounts).toEqual([{ user_id: "a", day: "2026-10-17", count: 2 }]);
    expect(drained.members).toEqual([{ ...alice, display_name: "Alice 2" }]);
  });

  it("restores a failed drain on top of newer reactions", () => {
    const buf = new ReactionBuffer();
    buf.addEmoji(pog, day);
    buf.addReceived(alice, day);
    const old = buf.drain();
    buf.addEmoji({ ...pog, name: "poggers" }, day);
    buf.restore(old);
    const drained = buf.drain();
    expect(drained.emojis).toEqual([{ ...pog, name: "poggers" }]);
    expect(drained.emojiCounts).toEqual([{ emoji_key: "111", day: "2026-10-17", count: 2 }]);
    expect(drained.receivedCounts).toEqual([{ user_id: "a", day: "2026-10-17", count: 1 }]);
    expect(drained.members).toEqual([alice]);
  });
});

describe("flushReactions", () => {
  function writer(overrides: Partial<ReactionWriter> = {}): ReactionWriter {
    return {
      upsertMembers: vi.fn(async () => {}),
      incrementReactions: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("does nothing when empty", async () => {
    const w = writer();
    await flushReactions(new ReactionBuffer(), w);
    expect(w.upsertMembers).not.toHaveBeenCalled();
    expect(w.incrementReactions).not.toHaveBeenCalled();
  });

  it("writes authors before the counts that reference them", async () => {
    const order: string[] = [];
    const w = writer({
      upsertMembers: async () => void order.push("members"),
      incrementReactions: async () => void order.push("counts"),
    });
    const buf = new ReactionBuffer();
    buf.addEmoji(thumbs, day);
    buf.addReceived(alice, day);
    await flushReactions(buf, w, () => "b1");
    expect(order).toEqual(["members", "counts"]);
    expect(buf.isEmpty).toBe(true);
  });

  it("keeps everything when the members write fails", async () => {
    const buf = new ReactionBuffer();
    buf.addEmoji(thumbs, day);
    buf.addReceived(alice, day);
    const w = writer({ upsertMembers: async () => Promise.reject(new Error("down")) });
    await expect(flushReactions(buf, w)).rejects.toThrow("down");
    expect(w.incrementReactions).not.toHaveBeenCalled();
    expect(buf.drain()).toEqual({
      members: [alice],
      emojis: [thumbs],
      emojiCounts: [{ emoji_key: "👍", day: "2026-10-17", count: 1 }],
      receivedCounts: [{ user_id: "a", day: "2026-10-17", count: 1 }],
    });
  });

  it("counts once when a committed write loses its response and is retried", async () => {
    const applied = new Set<string>();
    let total = 0;
    let loseResponse = true;
    const sent: ReactionBatch[] = [];
    const w = writer({
      incrementReactions: async (batch) => {
        sent.push(batch);
        if (!applied.has(batch.id)) {
          applied.add(batch.id);
          for (const c of batch.emojiCounts) total += c.count;
        }
        if (loseResponse) {
          loseResponse = false;
          throw new Error("connection reset");
        }
      },
    });
    const ids = ["b1", "b2"];
    const newId = () => ids.shift()!;

    const buf = new ReactionBuffer();
    buf.addEmoji(thumbs, day);
    buf.addEmoji(thumbs, day);
    await expect(flushReactions(buf, w, newId)).rejects.toThrow("connection reset");
    expect(buf.pending?.id).toBe("b1");

    buf.addEmoji(thumbs, day);
    await flushReactions(buf, w, newId);

    expect(sent.map((b) => b.id)).toEqual(["b1", "b1", "b2"]);
    expect(total).toBe(3);
    expect(buf.isEmpty).toBe(true);
  });
});
