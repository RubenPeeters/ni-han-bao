import { readFileSync } from "node:fs";
import { ApplicationCommandOptionType } from "discord.js";
import { describe, expect, it } from "vitest";
import { COMMANDS, commandReference, REFERENCE_PATH, type RefCommand } from "./commands.js";

describe("commandReference", () => {
  it("lists subcommands as their own usages, with options and choices", () => {
    const ref = commandReference([
      {
        name: "lol",
        description: "League",
        default_member_permissions: "32",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "link",
            description: "Link it",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "region",
                description: "Where",
                required: true,
                choices: [{ name: "EU West" }],
              },
            ],
          },
          { type: ApplicationCommandOptionType.Subcommand, name: "unlink", description: "Unlink it" },
        ],
      },
      { name: "me", description: "You" },
    ]);
    expect(ref).toEqual([
      {
        name: "lol",
        description: "League",
        admin: true,
        usages: [
          {
            name: "lol link",
            description: "Link it",
            options: [{ name: "region", description: "Where", type: "string", required: true, choices: ["EU West"] }],
          },
          { name: "lol unlink", description: "Unlink it", options: [] },
        ],
      },
      { name: "me", description: "You", admin: false, usages: [{ name: "me", description: "You", options: [] }] },
    ]);
  });
});

describe("the website's command reference (lib/commands.json)", () => {
  const committed = JSON.parse(readFileSync(REFERENCE_PATH, "utf8")) as RefCommand[];
  const stale = "out of date: run `pnpm --filter ni-han-bao-bot commands`";

  it("has every registered command", () => {
    const missing = COMMANDS.map((c) => c.name).filter((n) => !committed.some((c) => c.name === n));
    expect(missing, stale).toEqual([]);
  });

  it("matches the command definitions", () => {
    expect(committed, stale).toEqual(commandReference(COMMANDS));
  });
});
