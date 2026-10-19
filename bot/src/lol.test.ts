import { describe, expect, it, vi } from "vitest";
import { challengeText, LOL_COMMAND, parseRiotId, pickIcon, startLink, verifyLink, type Challenge, type RiotLookup } from "./lol.js";
import { STARTER_ICON_NAMES } from "./starter-icons.js";

describe("parseRiotId", () => {
  it("splits at the last #", () => {
    expect(parseRiotId(" Faker#KR1 ")).toEqual({ gameName: "Faker", tagLine: "KR1" });
    expect(parseRiotId("a#b c#EUW")).toEqual({ gameName: "a#b c", tagLine: "EUW" });
  });

  it("rejects what is not a Riot ID", () => {
    expect(parseRiotId("Faker")).toBeNull();
    expect(parseRiotId("Faker#")).toBeNull();
    expect(parseRiotId("#EUW")).toBeNull();
    expect(parseRiotId("Faker#TOOLONG")).toBeNull();
  });
});

describe("pickIcon", () => {
  it("picks a starter icon other than the current one", () => {
    for (const current of [0, 5, 28, 4000]) {
      for (const r of [0, 0.5, 0.9999]) {
        const icon = pickIcon(current, () => r);
        expect(icon).not.toBe(current);
        expect(icon).toBeGreaterThanOrEqual(0);
        expect(icon).toBeLessThanOrEqual(28);
      }
    }
  });

  it("names every icon it can pick, so it can be searched for in the client", () => {
    for (let current = 0; current <= 29; current++) {
      for (let i = 0; i < 28; i++) {
        expect(STARTER_ICON_NAMES[pickIcon(current, () => i / 28)]).toMatch(/\S/);
      }
    }
  });
});

it("offers at most the 25 choices Discord allows", () => {
  expect(LOL_COMMAND.options[0].options[1].choices.length).toBeLessThanOrEqual(25);
});

function lookup(icon: number | null = 7): RiotLookup & { account: ReturnType<typeof vi.fn> } {
  return {
    account: vi.fn(async () => ({ puuid: "p", gameName: "Faker", tagLine: "KR1" })),
    icon: async () => icon,
  };
}

describe("startLink", () => {
  it("asks Account-V1 on the platform's regional route", async () => {
    const riot = lookup();
    const challenge = await startLink(riot, "faker#kr1", "kr");
    expect(riot.account).toHaveBeenCalledWith("asia", "faker", "kr1");
    expect(challenge).toMatchObject({ puuid: "p", riotId: "Faker#KR1", platform: "kr" });
    expect((challenge as Challenge).icon).not.toBe(7);
  });

  it("says why it cannot link", async () => {
    expect(await startLink(lookup(), "Faker", "kr")).toMatch(/not a Riot ID/);
    expect(await startLink(lookup(), "Faker#KR1", "toString")).toMatch(/Unknown region/);
    expect(await startLink({ ...lookup(), account: async () => null }, "Faker#KR1", "kr")).toMatch(/no Riot account/);
    expect(await startLink(lookup(null), "Faker#KR1", "euw1")).toMatch(/no League account on Europe West/);
  });
});

describe("verifyLink", () => {
  const challenge: Challenge = { puuid: "p", riotId: "Faker#KR1", platform: "kr", icon: 3 };

  it("links once the icon matches", async () => {
    const link = vi.fn(async () => true);
    expect(await verifyLink(lookup(3), { link }, "u", challenge)).toMatchObject({ done: true, reply: expect.stringMatching(/^Linked/) });
    expect(link).toHaveBeenCalledWith("u", challenge);
  });

  it("asks for the icon by name", () => {
    expect(challengeText({ ...challenge, icon: 8 })).toMatch(/\*\*Ancient Golem Icon\*\* \(icon 8/);
  });

  it("keeps waiting while the icon differs", async () => {
    const link = vi.fn(async () => true);
    expect(await verifyLink(lookup(7), { link }, "u", challenge)).toMatchObject({
      done: false,
      reply: expect.stringContaining("not **Blue Minion Caster Icon** (icon 3) yet"),
    });
    expect(link).not.toHaveBeenCalled();
  });

  it("tells a forgotten user nothing was saved", async () => {
    expect((await verifyLink(lookup(3), { link: async () => false }, "u", challenge)).reply).toMatch(/show-me/);
  });
});
