import { describe, expect, it } from "vitest";
import { eventChoices, eventLabel, eventsField, goingEventId, goingId, goingText, matchStore, parseWhen, type UpcomingEvent } from "./events.js";

const now = new Date("2026-10-18T12:00:00Z");
const event = (id: number, extra: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  id,
  name: null,
  starts_at: "2026-10-25T17:00:00Z",
  url: null,
  store_name: "Shop",
  store_city: "Gent",
  going: [],
  ...extra,
});

describe("parseWhen", () => {
  it("reads the time in the server's time zone", () => {
    // Brussels is on CET (UTC+1) after the switch on 25 October.
    expect(parseWhen("2026-10-25 18:00", "Europe/Brussels", now)).toEqual(new Date("2026-10-25T17:00:00Z"));
    expect(parseWhen(" 2026-10-24T9:30 ", "UTC", now)).toEqual(new Date("2026-10-24T09:30:00Z"));
  });

  it.each(["tomorrow", "2026-02-30 10:00", "2026-10-25 24:00", "2026-10-25 10:60", "25-10-2026 10:00"])(
    "refuses %s",
    (text) => expect(parseWhen(text, "UTC", now)).toMatch(/like 2026-10-25 19:00/),
  );

  it("refuses a time that has passed", () => {
    expect(parseWhen("2026-10-18 11:59", "UTC", now)).toMatch(/passed/);
  });
});

describe("matchStore", () => {
  const stores = [
    { id: 1, name: "Dragon" },
    { id: 2, name: "Dragon's Lair" },
  ];
  it("picks the longest store name in the location, ignoring case", () => {
    expect(matchStore(stores, "dragon's lair, Gent")?.id).toBe(2);
    expect(matchStore(stores, "The Dragon pub")?.id).toBe(1);
  });
  it("finds nothing without a match or a location", () => {
    expect(matchStore(stores, "Online")).toBeNull();
    expect(matchStore(stores, null)).toBeNull();
  });
});

describe("goingEventId", () => {
  it("round-trips and refuses other buttons", () => {
    expect(goingEventId(goingId(42))).toBe(42);
    expect(goingEventId("forget-me:confirm")).toBeNull();
    expect(goingEventId("event-going:x")).toBeNull();
    expect(goingEventId("event-going:-1")).toBeNull();
  });
});

describe("eventLabel and eventChoices", () => {
  it("leaves out what the event does not have", () => {
    expect(eventLabel(event(1, { name: "Pre-release" }), "UTC")).toBe("Sun 25 Oct, 17:00 · Pre-release · Shop (Gent)");
    expect(eventLabel(event(1, { store_name: null, store_city: null }), "UTC")).toBe("Sun 25 Oct, 17:00");
  });
  it("filters on what was typed and caps at 25", () => {
    expect(eventChoices([event(1), event(2, { store_name: "Other" })], "other", "UTC")).toEqual([
      { name: "Sun 25 Oct, 17:00 · Other (Gent)", value: 2 },
    ]);
    expect(eventChoices(Array.from({ length: 30 }, (_, i) => event(i)), "", "UTC")).toHaveLength(25);
  });
});

describe("goingText", () => {
  it("names the store and time but not the member, and does not unfurl the link", () => {
    const text = goingText({ game: "Riftbound", name: "*Shop*", city: "Gent" }, "2026-10-25T17:00:00Z", "UTC", "https://x.be");
    expect(text).toBe("Someone is going at \\*Shop\\* \\(Gent\\) on Sun 25 Oct, 17:00. <https://x.be>\nComing too? Click Going.");
  });
});

describe("eventsField", () => {
  it("escapes names and says when nobody is going yet", () => {
    expect(eventsField([event(1, { going: ["_al_"] }), event(2)], "UTC")).toBe(
      "**Sun 25 Oct, 17:00 · Shop \\(Gent\\)**: \\_al\\_\n**Sun 25 Oct, 17:00 · Shop \\(Gent\\)**: nobody yet",
    );
  });
  it("stays under Discord's 1024 characters per field", () => {
    const many = Array.from({ length: 25 }, (_, i) => event(i, { going: ["Somebody with a long name"] }));
    expect(eventsField(many, "UTC").length).toBeLessThanOrEqual(1024);
  });
});
