import assert from "node:assert/strict";
import { test } from "node:test";
import { routesFrom } from "../scripts/screenshots.mjs";
import { DOCS } from "./docs.ts";

test("the sidebar lists every docs page, and only those", () => {
  const sidebar = DOCS.flatMap((s) => s.pages.map((p) => p.href)).sort();
  assert.deepEqual(sidebar, routesFrom().filter((r) => r === "/docs" || r.startsWith("/docs/")));
});
