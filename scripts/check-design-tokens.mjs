// Fails on colours and font sizes that bypass the design tokens (#22): hex values,
// Tailwind palette colours, arbitrary text-[...] values, sizes outside the type scale
// in tailwind.config.ts, and inline fontSize props.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RULES = [
  [/#[0-9a-fA-F]{3,8}\b/, "hex colour"],
  [new RegExp(`\\b[a-z]+-(?:${PALETTE})-\\d{2,3}\\b`), "palette colour"],
  [/\b[a-z]+-(?:white|black)\b/, "palette colour"],
  [/\btext-\[/, "arbitrary text value"],
  [/\btext-(?:xl|[35-9]xl)\b/, "text size outside the type scale"],
  [/\bfontSize\b/, "inline font size"],
];

export function violations(source) {
  return source.split("\n").flatMap((line, i) =>
    RULES.filter(([re]) => re.test(line)).map(([, what]) => `${i + 1}: ${what}: ${line.trim()}`),
  );
}

assert.equal(violations('<p className="text-sm text-muted-foreground">#general</p>').length, 0);
assert.equal(violations('<p className="text-red-600">').length, 1);
assert.equal(violations('<td className="text-[10px]" style={{ color: "#fff" }}>').length, 2);
assert.equal(violations('<h1 className="text-3xl">').length, 1);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) files.push(full);
  }
};
walk("app");
walk("components");

let failed = false;
for (const file of files) {
  for (const v of violations(readFileSync(file, "utf8"))) {
    failed = true;
    console.error(`FAIL ${file}:${v}`);
  }
}
console.log(failed ? "design tokens: violations found" : `design tokens: ok (${files.length} files)`);
process.exit(failed ? 1 : 0);
