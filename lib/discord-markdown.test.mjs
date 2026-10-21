import assert from "node:assert/strict";
import { test } from "node:test";
import { discordMarkdown } from "./discord-markdown.ts";

test("draws bold, escapes, mentions, links and custom emoji", () => {
  assert.deepEqual(discordMarkdown("**Shop \\(Gent\\)**: <#1> <#2> <https://x.be> <:pog:3>", { 1: "general" }), [
    { kind: "bold", children: [{ kind: "text", text: "Shop " }, { kind: "text", text: "(" }, { kind: "text", text: "Gent" }, { kind: "text", text: ")" }] },
    { kind: "text", text: ": " },
    { kind: "channel", name: "general" },
    { kind: "text", text: " " },
    { kind: "channel", name: "unknown" },
    { kind: "text", text: " " },
    { kind: "link", url: "https://x.be" },
    { kind: "text", text: " " },
    { kind: "emoji", name: "pog" },
  ]);
});

test("names mentioned users, as Discord does an unknown one", () => {
  assert.deepEqual(discordMarkdown("<@1> lent <@!2>", {}, { 1: "Anna" }), [
    { kind: "user", name: "Anna" },
    { kind: "text", text: " lent " },
    { kind: "user", name: "unknown-user" },
  ]);
});

test("leaves plain text and lone stars alone", () => {
  assert.deepEqual(discordMarkdown("1 * 2\nnext"), [{ kind: "text", text: "1 * 2\nnext" }]);
});
