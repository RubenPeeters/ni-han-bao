import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { routesFrom } from "../scripts/screenshots.mjs";
import { DOCS } from "./docs.ts";

test("the sidebar lists every docs page, and only those", () => {
  const sidebar = DOCS.flatMap((s) => s.pages.map((p) => p.href)).sort();
  assert.deepEqual(sidebar, routesFrom().filter((r) => r === "/docs" || r.startsWith("/docs/")));
});

test("every image a docs page shows is committed, so none is ever broken", () => {
  const pages = routesFrom().filter((r) => r.startsWith("/docs")).map((r) => readFileSync(`app${r}/page.mdx`, "utf8"));
  const images = pages.flatMap((text) => [...text.matchAll(/!\[[^\]]*\]\((\/[^)]+)\)/g)].map((m) => m[1]));
  assert.ok(images.length > 0);
  assert.deepEqual(images.filter((src) => !existsSync(`public${src}`)), []);
});
