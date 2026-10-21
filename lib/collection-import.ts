// Collection import from CSV (#242): pure, so quoting, BOMs and line ends are tested without a browser.

export interface ImportRow {
  /** 1-based line of the file, for the skipped list. */
  line: number;
  printing_id: string;
  name: string;
  quantity: number;
  want: number;
}

export interface BadRow {
  line: number;
  text: string;
  reason: string;
}

export interface ImportPreview {
  matched: ImportRow[];
  /** Well-formed rows whose card_id is not a printing in the catalogue. */
  unknown: ImportRow[];
  invalid: BadRow[];
}

const COLUMNS = ["card_id", "quantity", "want_quantity"] as const;
// A sane upper bound per row, well inside the database's integer.
const COUNT = /^\d{1,4}$/;

/** RFC 4180 records with their starting line: quoted fields may hold commas, "" and line breaks. */
function records(text: string) {
  const out: { line: number; fields: string[]; raw: string }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let from = 0;
  const end = (i: number, next: number) => {
    fields.push(field);
    const raw = text.slice(from, i);
    if (raw.trim()) out.push({ line: start, fields, raw });
    fields = [];
    field = "";
    from = next;
    start = line;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[i++];
      else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\n") {
      line++;
      end(text[i - 1] === "\r" ? i - 1 : i, i + 1);
    } else if (c !== "\r" || text[i + 1] !== "\n") field += c;
  }
  end(text.length, text.length);
  return out;
}

/** The file as the preview shows it: `known` says whether a card_id is a printing in the catalogue. */
export function parseCollectionCsv(text: string, known: (printingId: string) => boolean): ImportPreview {
  const preview: ImportPreview = { matched: [], unknown: [], invalid: [] };
  const [header, ...rows] = records(text.replace(/^\uFEFF/, ""));
  const names = header?.fields.map((f) => f.trim().toLowerCase()) ?? [];
  const missing = COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) {
    preview.invalid.push({ line: 1, text: header?.raw ?? "", reason: `No ${missing.join(", ")} column in the header` });
    return preview;
  }
  const at = (fields: string[], column: string) => (fields[names.indexOf(column)] ?? "").trim();
  for (const { line, fields, raw } of rows) {
    if (fields.length < names.length) {
      preview.invalid.push({ line, text: raw, reason: `${fields.length} of ${names.length} columns` });
      continue;
    }
    const id = at(fields, "card_id").toLowerCase();
    const quantity = at(fields, "quantity");
    const want = at(fields, "want_quantity");
    const bad = !id ? "No card_id" : !COUNT.test(quantity) ? "quantity is not a whole number" : !COUNT.test(want) ? "want_quantity is not a whole number" : "";
    if (bad) {
      preview.invalid.push({ line, text: raw, reason: bad });
      continue;
    }
    const row = { line, printing_id: id, name: at(fields, "name"), quantity: Number(quantity), want: Number(want) };
    (known(id) ? preview.matched : preview.unknown).push(row);
  }
  return preview;
}
