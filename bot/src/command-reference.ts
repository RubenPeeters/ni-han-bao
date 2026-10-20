// Writes the website's command reference and reply examples from the bot's own code:
// `pnpm --filter ni-han-bao-bot commands`. The tests fail while either is out of date.
import { writeFileSync } from "node:fs";
import { COMMANDS, commandReference, REFERENCE_PATH } from "./commands.js";
import { EXAMPLES_PATH, replyExamples } from "./reply-examples.js";

writeFileSync(REFERENCE_PATH, JSON.stringify(commandReference(COMMANDS), null, 2) + "\n");
writeFileSync(EXAMPLES_PATH, JSON.stringify(replyExamples(), null, 2) + "\n");
console.log("wrote lib/commands.json and lib/replies.json");
