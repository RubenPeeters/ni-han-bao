// Writes the website's command reference from the bot's command definitions:
// `pnpm --filter ni-han-bao-bot commands`. commands.test.ts fails while it is out of date.
import { writeFileSync } from "node:fs";
import { COMMANDS, commandReference, REFERENCE_PATH } from "./commands.js";

writeFileSync(REFERENCE_PATH, JSON.stringify(commandReference(COMMANDS), null, 2) + "\n");
console.log("wrote lib/commands.json");
