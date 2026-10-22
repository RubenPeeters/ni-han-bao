import { ApplicationCommandOptionType, ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { COLLECTION_COMMAND } from "./collection.js";
import { DECK_COMMAND } from "./decks.js";
import { EVENT_COMMAND } from "./events.js";
import { FEEDBACK_COMMAND } from "./feedback-modal.js";
import { FORGET_COMMAND } from "./forget.js";
import { LEND_COMMAND, RETURN_COMMAND } from "./lending.js";
import { LOL_COMMAND } from "./lol.js";
import { PROFILE_COMMAND } from "./profile.js";
import { RECAP_COMMAND } from "./recap.js";
import { CARD_COMMAND } from "./riftbound.js";
import { SETUP_COMMAND } from "./setup.js";
import { STATS_COMMANDS } from "./stats.js";
import { STORE_COMMAND } from "./stores.js";
import { VISIBILITY_COMMANDS } from "./visibility.js";
import { WISHLIST_COMMAND } from "./profile-share.js";

/** Every slash command the bot registers, in the order the docs list them. */
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
  WISHLIST_COMMAND,
  DECK_COMMAND,
  LEND_COMMAND,
  RETURN_COMMAND,
  FEEDBACK_COMMAND,
];

/** Commands that also work in DMs once a member adds the app to their account (#250). */
const EVERYWHERE = new Set<string>([CARD_COMMAND.name, DECK_COMMAND.name, COLLECTION_COMMAND.name, WISHLIST_COMMAND.name]);

/** Registered once for the whole application, for servers and for members' own accounts, in servers, the bot's DMs and other DMs. */
export const GLOBAL_COMMANDS = COMMANDS.filter((c) => EVERYWHERE.has(c.name)).map((c) => ({
  ...c,
  integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
  contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
}));

/** Registered per server: the rest, so a global command does not show up twice there. */
export const GUILD_COMMANDS = COMMANDS.filter((c) => !EVERYWHERE.has(c.name));

/** Whether the registered global commands differ from the wanted ones, with discord.js's ApplicationCommand#equals. */
export function globalCommandsChanged<T>(registered: readonly { name: string; equals(command: T, enforceOptionOrder: boolean): boolean }[], wanted: readonly (T & { name: string })[]): boolean {
  return registered.length !== wanted.length || !wanted.every((w) => registered.some((r) => r.name === w.name && r.equals(w, true)));
}

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
