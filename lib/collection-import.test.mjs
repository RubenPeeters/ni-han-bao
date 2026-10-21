import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCollectionCsv } from "./collection-import.ts";

const HEADER = "card_id,name,set_code,type,rarity,quantity,want_quantity";
const known = (id) => id.startsWith("ogn-") || id.startsWith("ogs-");

test("quoted fields, a BOM and CRLF line ends", () => {
  const csv = `﻿${HEADER}\r\n"ogs-002-024","Firestorm","OGS","spell","uncommon","3","0"\r\n"ogn-005-298","Kai'Sa, ""Daughter""","OGN","unit","rare","1","2"\r\n`;
  assert.deepEqual(parseCollectionCsv(csv, known), {
    matched: [
      { line: 2, printing_id: "ogs-002-024", name: "Firestorm", quantity: 3, want: 0 },
      { line: 3, printing_id: "ogn-005-298", name: 'Kai\'Sa, "Daughter"', quantity: 1, want: 2 },
    ],
    unknown: [],
    invalid: [],
  });
});

test("unknown ids, bad numbers and short rows are kept apart", () => {
  const csv = [
    HEADER,
    '"xyz-001-001","Nope","XYZ","unit","common","1","0"',
    '"ogn-001-001","A","OGN","unit","common","two","0"',
    '"ogn-001-002","B","OGN","unit","common","1","-1"',
    '"ogn-001-003","C","OGN","unit","common","1.5","0"',
    '"ogn-001-004","D","OGN"',
    "",
    '"OGN-001-005","E","OGN","unit","common","0","0"',
  ].join("\n");
  const { matched, unknown, invalid } = parseCollectionCsv(csv, known);
  assert.deepEqual(matched, [{ line: 8, printing_id: "ogn-001-005", name: "E", quantity: 0, want: 0 }]);
  assert.deepEqual(unknown.map((r) => r.printing_id), ["xyz-001-001"]);
  assert.deepEqual(
    invalid.map((r) => [r.line, r.reason]),
    [
      [3, "quantity is not a whole number"],
      [4, "want_quantity is not a whole number"],
      [5, "quantity is not a whole number"],
      [6, "3 of 7 columns"],
    ],
  );
  assert.equal(invalid[3].text, '"ogn-001-004","D","OGN"');
});

test("a header without the needed columns rejects the file", () => {
  const { matched, invalid } = parseCollectionCsv('card_id,name,quantity\n"ogn-001-001","A","1"', known);
  assert.equal(matched.length, 0);
  assert.deepEqual(invalid.map((r) => r.reason), ["No want_quantity column in the header"]);
  assert.equal(parseCollectionCsv("", known).invalid.length, 1);
});
