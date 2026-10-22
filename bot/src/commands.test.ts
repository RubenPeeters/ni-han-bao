import { readFileSync } from "node:fs";
import { ApplicationCommandOptionType, ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { describe, expect, it } from "vitest";
import { COMMANDS, commandReference, GLOBAL_COMMANDS, globalCommandsChanged, GUILD_COMMANDS, REFERENCE_PATH, type RefCommand } from "./commands.js";

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

describe("where the commands are registered (#250)", () => {
  it("registers /card, /deck, /collection and /wishlist globally, for servers and accounts, in servers and DMs", () => {
    expect(GLOBAL_COMMANDS.map((c) => c.name).sort()).toEqual(["card", "collection", "deck", "wishlist"]);
    for (const c of GLOBAL_COMMANDS) {
      expect(c.integration_types).toEqual([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
      expect(c.contexts).toEqual([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
    }
  });

  it("registers every other command per server, and none in both places", () => {
    const names = [...GLOBAL_COMMANDS, ...GUILD_COMMANDS].map((c) => c.name);
    expect(names.sort()).toEqual(COMMANDS.map((c) => c.name).sort());
    expect(GUILD_COMMANDS.map((c) => c.name)).toContain("setup");
  });

  it("rewrites the global commands only when one was added, removed or changed", () => {
    const wanted = [{ name: "card" }, { name: "deck" }];
    const registered = (...same: boolean[]) => wanted.map((w, i) => ({ name: w.name, equals: () => same[i] }));
    expect(globalCommandsChanged(registered(true, true), wanted)).toBe(false);
    expect(globalCommandsChanged(registered(true, false), wanted)).toBe(true);
    expect(globalCommandsChanged(registered(true), wanted)).toBe(true);
    expect(globalCommandsChanged([], wanted)).toBe(true);
    expect(globalCommandsChanged([...registered(true, true), { name: "old", equals: () => false }], wanted)).toBe(true);
  });
});
