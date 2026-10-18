import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { applySetup, DEFAULT_SETTINGS, SETUP_COMMAND, setupChange, type GuildSettings } from "./setup.js";

const input = { subcommand: "show", channelId: null, canSend: false, timezone: null };

describe("SETUP_COMMAND", () => {
  it("is for members with Manage Server only", () => {
    expect(SETUP_COMMAND.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
  });
});

describe("setupChange", () => {
  it("sets a report channel the bot can post in", () => {
    expect(setupChange({ ...input, subcommand: "report-channel", channelId: "c1", canSend: true })).toEqual({
      report_channel_id: "c1",
    });
  });
  it("refuses a channel the bot cannot post in", () => {
    expect(setupChange({ ...input, subcommand: "report-channel", channelId: "c1" })).toMatch(/cannot post in <#c1>/);
  });
  it("turns the report off without a channel", () => {
    expect(setupChange({ ...input, subcommand: "report-channel" })).toEqual({ report_channel_id: null });
  });
  it("stores the canonical time zone name", () => {
    expect(setupChange({ ...input, subcommand: "timezone", timezone: "europe/brussels" })).toEqual({
      timezone: "Europe/Brussels",
    });
  });
  it("refuses an unknown time zone", () => {
    expect(setupChange({ ...input, subcommand: "timezone", timezone: "Brussels" })).toMatch(/not a time zone/);
  });
  it("changes nothing for show", () => expect(setupChange(input)).toBeNull());
});

describe("applySetup", () => {
  const saved: Partial<GuildSettings>[] = [];
  const writer = { save: async (c: Partial<GuildSettings>) => void saved.push(c) };

  it("saves the change and replies with the new settings", async () => {
    const { reply, settings } = await applySetup(writer, DEFAULT_SETTINGS, { report_channel_id: "c1" });
    expect(saved).toEqual([{ report_channel_id: "c1" }]);
    expect(settings).toEqual({ report_channel_id: "c1", timezone: "UTC" });
    expect(reply).toBe("Saved.\nWeekly report card: <#c1>\nTime zone: UTC");
  });
  it("shows the settings without saving", async () => {
    const { reply } = await applySetup(
      { save: () => Promise.reject(new Error("no")) },
      DEFAULT_SETTINGS,
      null,
    );
    expect(reply).toMatch(/Weekly report card: off/);
  });
  it("keeps the old settings when the save fails", async () => {
    const result = await applySetup({ save: () => Promise.reject(new Error("db down")) }, DEFAULT_SETTINGS, {
      timezone: "Europe/Brussels",
    });
    expect(result.settings).toBe(DEFAULT_SETTINGS);
    expect(result.reply).toMatch(/nothing was changed/);
  });
  it("passes a refusal through", async () => {
    expect((await applySetup(writer, DEFAULT_SETTINGS, "nope")).reply).toBe("nope");
  });
});
