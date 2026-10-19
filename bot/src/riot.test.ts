import { describe, expect, it, vi } from "vitest";
import { retryAfterMs, RiotApi, waitMs } from "./riot.js";

describe("waitMs", () => {
  const limits = [{ count: 2, ms: 1_000 }];

  it("lets a request go while under the limit", () => {
    expect(waitMs([500], 1_000, limits)).toBe(0);
  });

  it("waits for the oldest request of a full window to leave it", () => {
    expect(waitMs([200, 600], 1_000, limits)).toBe(200);
    expect(waitMs([100, 200, 600], 1_000, limits)).toBe(200);
  });

  it("takes the longest wait of all limits", () => {
    expect(waitMs([0, 900], 1_000, [...limits, { count: 1, ms: 5_000 }])).toBe(4_900);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds, with a fallback when Riot sends none", () => {
    expect(retryAfterMs("3")).toBe(3_000);
    expect(retryAfterMs(null)).toBe(10_000);
    expect(retryAfterMs("soon")).toBe(10_000);
  });
});

function api(responses: Response[]) {
  let now = 0;
  const sleeps: number[] = [];
  const fetchFn = vi.fn(async () => responses.shift()!);
  const riot = new RiotApi("key", fetchFn, () => now, async (ms) => {
    sleeps.push(ms);
    now += ms;
  });
  return { riot, fetchFn, sleeps };
}

describe("RiotApi", () => {
  it("sends the key and parses the body", async () => {
    const { riot, fetchFn } = api([Response.json({ puuid: "p" })]);
    expect(await riot.get("europe", "/x")).toEqual({ puuid: "p" });
    expect(fetchFn).toHaveBeenCalledWith("https://europe.api.riotgames.com/x", expect.objectContaining({ headers: { "X-Riot-Token": "key" } }));
  });

  it("returns null on 404 and throws on other errors", async () => {
    const { riot } = api([new Response(null, { status: 404 }), new Response(null, { status: 403 })]);
    expect(await riot.get("europe", "/x")).toBeNull();
    await expect(riot.get("europe", "/x")).rejects.toThrow("403");
  });

  it("waits Retry-After on a 429, then retries", async () => {
    const { riot, sleeps } = api([new Response(null, { status: 429, headers: { "Retry-After": "2" } }), Response.json(1)]);
    expect(await riot.get("europe", "/x")).toBe(1);
    expect(sleeps).toEqual([2_000]);
  });

  it("gives up after a few 429s", async () => {
    const { riot, fetchFn } = api(Array.from({ length: 5 }, () => new Response(null, { status: 429, headers: { "Retry-After": "1" } })));
    await expect(riot.get("europe", "/x")).rejects.toThrow("429");
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("queues requests under the per-second limit", async () => {
    const { riot, sleeps } = api(Array.from({ length: 21 }, () => Response.json(1)));
    await Promise.all(Array.from({ length: 21 }, () => riot.get("euw1", "/x")));
    expect(sleeps).toEqual([1_000]);
  });
});
