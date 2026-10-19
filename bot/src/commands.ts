import { ApplicationCommandOptionType } from "discord.js";
import { COLLECTION_COMMAND } from "./collection.js";
import { EVENT_COMMAND } from "./events.js";
import { FORGET_COMMAND } from "./forget.js";
import { LOL_COMMAND } from "./lol.js";
import { PROFILE_COMMAND } from "./profile.js";
import { RECAP_COMMAND } from "./recap.js";
import { CARD_COMMAND } from "./riftbound.js";
import { SETUP_COMMAND } from "./setup.js";
import { STATS_COMMANDS } from "./stats.js";
import { STORE_COMMAND } from "./stores.js";
import { VISIBILITY_COMMANDS } from "./visibility.js";

/** Every slash command the bot registers in a server, in the order the docs list them. */
export const COMMANDS = [
  ...VISIBILITY_COMMANDS,
  FORGET_COMMAND,
  PROFILE_COMMAND,
  LOL_COMMAND,
  ...STATS_COMMANDS,
  SETUP_COMMAND,
  RECAP_COMMAND,
  STORE_COMMAND,
  EVENT_COMMAND,
  CARD_COMMAND,
  COLLECTION_COMMAND,
];

interface OptionDef {
  type: ApplicationCommandOptionType;
  name: string;
  description: string;
  required?: boolean;
  choices?: readonly { name: string }[];
  options?: readonly OptionDef[];
}

interface CommandDef {
  name: string;
  description: string;
  default_member_permissions?: string;
  options?: readonly OptionDef[];
}

export interface RefOption {
  name: string;
  description: string;
  type: string;
  required: boolean;
  choices: string[];
}

/** One line of the reference: a command, or one of its subcommands (`lol link`). */
export interface RefUsage {
  name: string;
  description: string;
  options: RefOption[];
}

export interface RefCommand {
  name: string;
  description: string;
  /** Hidden from members without Manage Server. */
  admin: boolean;
  usages: RefUsage[];
}

const option = (o: OptionDef): RefOption => ({
  name: o.name,
  description: o.description,
  type: ApplicationCommandOptionType[o.type].toLowerCase(),
  required: o.required ?? false,
  choices: o.choices?.map((c) => c.name) ?? [],
});

const isSub = (o: OptionDef) =>
  o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup;

function usages(prefix: string, description: string, options: readonly OptionDef[] = []): RefUsage[] {
  const subs = options.filter(isSub);
  if (subs.length === 0) return [{ name: prefix, description, options: options.map(option) }];
  return subs.flatMap((s) => usages(`${prefix} ${s.name}`, s.description, s.options));
}

/** The command reference the website renders (lib/commands.json), straight from the definitions. */
export function commandReference(commands: readonly CommandDef[]): RefCommand[] {
  return commands.map((c) => ({
    name: c.name,
    description: c.description,
    admin: c.default_member_permissions !== undefined,
    usages: usages(c.name, c.description, c.options),
  }));
}

export const REFERENCE_PATH = new URL("../../lib/commands.json", import.meta.url);
