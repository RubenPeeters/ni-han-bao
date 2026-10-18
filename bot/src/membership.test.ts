import { describe, expect, it, vi } from "vitest";
import { membershipDiff, READ_PAGE, syncMembers, WRITE_CHUNK, type MembershipStore } from "./membership.js";

describe("membershipDiff", () => {
  it("adds newcomers and removes leavers, keeping who stayed", () => {
    expect(membershipDiff(["a", "b", "c"], ["b", "c", "d"])).toEqual({ add: ["d"], remove: ["a"] });
  });

  it("fills an empty store and empties a store for a server with no members", () => {
    expect(membershipDiff([], ["a", "b"])).toEqual({ add: ["a", "b"], remove: [] });
    expect(membershipDiff(["a", "b"], [])).toEqual({ add: [], remove: ["a", "b"] });
  });

  it("ignores duplicates on either side", () => {
    expect(membershipDiff(["a", "a"], ["b", "b"])).toEqual({ add: ["b"], remove: ["a"] });
  });
});

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function store(stored: string[]) {
  return {
    storedPage: vi.fn(async (from: number, to: number) => stored.slice(from, to + 1)),
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  } satisfies MembershipStore;
}

describe("syncMembers", () => {
  it("reads every page of stored members before diffing", async () => {
    const stored = ids(READ_PAGE + 1, "s");
    const s = store(stored);
    expect(await syncMembers(stored, s)).toEqual({ added: 0, removed: 0 });
    expect(s.storedPage).toHaveBeenCalledTimes(2);
    expect(s.add).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("writes in chunks", async () => {
    const s = store(ids(WRITE_CHUNK + 1, "old"));
    expect(await syncMembers(ids(WRITE_CHUNK * 2 + 1, "new"), s)).toEqual({
      added: WRITE_CHUNK * 2 + 1,
      removed: WRITE_CHUNK + 1,
    });
    expect(s.add.mock.calls.map(([c]) => c.length)).toEqual([WRITE_CHUNK, WRITE_CHUNK, 1]);
    expect(s.remove.mock.calls.map(([c]) => c.length)).toEqual([WRITE_CHUNK, 1]);
  });

  it("rejects when a write fails", async () => {
    const s = store([]);
    s.add.mockRejectedValueOnce(new Error("down"));
    await expect(syncMembers(["a"], s)).rejects.toThrow("down");
  });
});
