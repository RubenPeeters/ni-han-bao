import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.js";
import { EXAMPLES_PATH, replyExamples } from "./reply-examples.js";

describe("the website's reply examples (lib/replies.json)", () => {
  const stale = "out of date: run `pnpm --filter ni-han-bao-bot commands`";

  it("matches what the reply builders return", () => {
    const committed = JSON.parse(readFileSync(EXAMPLES_PATH, "utf8"));
    expect(committed, stale).toEqual(JSON.parse(JSON.stringify(replyExamples())));
  });

  it("answers registered commands only", () => {
    const names = new Set(COMMANDS.map((c) => c.name));
    const unknown = Object.values(replyExamples())
      .map((e) => e.command?.slice(1).split(" ")[0])
      .filter((name) => name !== undefined && !names.has(name));
    expect(unknown).toEqual([]);
  });
});
