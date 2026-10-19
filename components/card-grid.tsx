"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/stat-ui";
import {
  applyPlayset,
  CONDITIONS,
  FINISHES,
  NONE,
  parseKey,
  retryDelay,
  rowKey,
  shown as countOf,
  step,
  type Condition,
  type Copies,
  type Finish,
  type Mode,
  type OwnedRow,
} from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LibraryCard {
  id: string;
  name: string;
  type: string;
  domains: string[];
  energy: number | null;
  tags: string[];
  placeholder: boolean;
  sets: string[];
  codes: string[];
  /** Collector order; the steppers change the first, or the one a typed code finds. */
  printings: { id: string; set_code: string; collector_code: string }[];
  image_url: string | null;
}

/** The visitor's own collection, for the steppers. */
export interface MyCollection {
  userId: string;
  owned: OwnedRow[];
  lends: boolean;
  lendAll: boolean;
}

const MODES: { value: Mode; label: string }[] = [
  { value: "quantity", label: "Owned" },
  { value: "for_trade", label: "For trade" },
  { value: "lendable", label: "To lend" },
];

// Case, accents and apostrophes do not matter, as in the bot's resolveCard(): "kaisa" finds "Kai'Sa".
const normal = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/['‘’]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
// A collector code without case, dashes or spaces, as in the bot's codeKey(): "ogn 001" finds "OGN-001".
const codeKey = (text: string) => text.replace(/[\s-]+/g, "").toLowerCase();
const sorted = <T,>(values: T[]) => [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// Hundreds of tiles at once are a long page and many image loads on a phone.
const PAGE = 24;
const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The library: everything is sent once and filtered here, so search answers on every key. */
export function CardGrid({ cards, mine }: { cards: LibraryCard[]; mine: MyCollection }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [domain, setDomain] = useState("");
  const [cost, setCost] = useState("");
  const [set, setSet] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>("quantity");
  const [finish, setFinish] = useState<Finish>("normal");
  const [condition, setCondition] = useState<Condition>("NM");
  const collection = useCollection(mine);
  const q = normal(query);
  const code = codeKey(query);
  const shown = cards.filter(
    (c) =>
      (!q || normal(c.name).includes(q) || c.tags.some((t) => normal(t).includes(q)) || (code && c.codes.some((k) => codeKey(k).startsWith(code)))) &&
      (!type || c.type === type) &&
      (!domain || c.domains.includes(domain)) &&
      (!cost || String(c.energy) === cost) &&
      (!set || c.sets.includes(set)),
  );
  const filters = [
    { label: "Type", all: "All types", value: type, set: setType, options: sorted(cards.map((c) => c.type)) },
    { label: "Domain", all: "All domains", value: domain, set: setDomain, options: sorted(cards.flatMap((c) => c.domains)) },
    {
      label: "Cost",
      all: "Any cost",
      value: cost,
      set: setCost,
      options: sorted(cards.flatMap((c) => (c.energy === null ? [] : [c.energy]))).map(String),
    },
    { label: "Set", all: "All sets", value: set, set: setSet, options: sorted(cards.flatMap((c) => c.sets)) },
  ];
  const sets = filters[3].options;
  const playsetOf = set || (sets.length === 1 ? sets[0] : "");
  const printingOf = (c: LibraryCard) =>
    (code && c.printings.find((p) => codeKey(p.collector_code).startsWith(code))) || c.printings[0];
  const tap = (c: LibraryCard, delta: number) => {
    const p = printingOf(c);
    if (p) collection.change(rowKey(p.id, finish, condition), (row) => step(row, mode, delta, mine.lendAll));
  };
  return (
    <div className="flex flex-col gap-4">
      {/* Stays in reach while scrolling the grid, so the next search is one thumb away. */}
      <div role="search" className="sticky top-0 z-10 -mx-5 flex flex-col gap-2 border-b bg-background/95 px-5 py-3 backdrop-blur">
        <Input
          type="search"
          aria-label="Search cards by name, champion or collector code"
          placeholder="Search by name, champion or code"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Card in hand, code typed, Enter: one more, without reaching for the mouse.
          onKeyDown={(e) => {
            if (e.key === "Enter" && editing && shown.length === 1) tap(shown[0], e.shiftKey ? -1 : 1);
          }}
          className="h-11 text-base md:text-base"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {filters.map((f) => (
            <select key={f.label} aria-label={f.label} value={f.value} onChange={(e) => f.set(e.target.value)} className={field}>
              <option value="">{f.all}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {f.label === "Cost" ? `${o} energy` : o}
                </option>
              ))}
            </select>
          ))}
        </div>
        {editing && (
          <div className="grid grid-cols-3 gap-2">
            <select aria-label="What the steppers count" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={field}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select aria-label="Finish" value={finish} onChange={(e) => setFinish(e.target.value as Finish)} className={field}>
              {FINISHES.map((f) => (
                <option key={f} value={f}>
                  {f === "normal" ? "Normal" : "Foil"}
                </option>
              ))}
            </select>
            <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as Condition)} className={field}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {shown.length === cards.length
              ? `${cards.length.toLocaleString("en-US")} cards`
              : `${shown.length.toLocaleString("en-US")} of ${cards.length.toLocaleString("en-US")} cards`}
            {collection.status && ` · ${collection.status}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {editing && playsetOf && (
              <Button
                variant="secondary"
                size="sm"
                // The database tops up from what it has, so the taps go first.
                disabled={collection.waiting > 0}
                onClick={() => collection.playset(playsetOf, cards.flatMap((c) => c.printings.filter((p) => p.set_code === playsetOf).map((p) => p.id)))}
              >
                I own a playset of {playsetOf}
              </Button>
            )}
            <Button variant={editing ? "default" : "secondary"} size="sm" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit my collection"}
            </Button>
          </div>
        </div>
        {editing && mode === "lendable" && !mine.lends && (
          <p className="text-xs text-muted-foreground">
            You do not lend cards, so nobody sees these counts. Turn on I lend cards on your profile.
          </p>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState>No card matches. Try fewer filters.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {shown.slice(0, limit).map((c) => {
            const p = printingOf(c);
            const count = p ? countOf(collection.rows.get(rowKey(p.id, finish, condition)) ?? NONE, mode, mine.lendAll) : 0;
            const owned = collection.owned(c);
            return (
              <li key={c.id} className="flex min-w-0 flex-col gap-2">
                <Link
                  href={`/cards/${c.id}`}
                  className="flex flex-col gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80"
                >
                  <CardImage url={c.image_url} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium" title={c.name}>
                      {c.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[c.type, c.energy !== null && `${c.energy} energy`, ...c.domains].filter(Boolean).join(" · ")}
                    </span>
                    {/* Made up until Riot approves the API key: nobody may mistake it for a real card. */}
                    {c.placeholder && (
                      <Badge variant="secondary" className="w-fit">
                        Placeholder card
                      </Badge>
                    )}
                    {owned > 0 && <span className="text-xs font-medium">{owned.toLocaleString("en-US")} owned</span>}
                  </span>
                </Link>
                {editing && p && (
                  <div className="mt-auto flex items-center justify-between gap-1">
                    <Button variant="secondary" size="icon" className="size-11" aria-label={`One fewer: ${c.name}`} disabled={count === 0} onClick={() => tap(c, -1)}>
                      <Minus aria-hidden />
                    </Button>
                    <span className="min-w-0 text-center text-lg font-semibold tabular-nums">{count}</span>
                    <Button variant="secondary" size="icon" className="size-11" aria-label={`One more: ${c.name}`} onClick={() => tap(c, 1)}>
                      <Plus aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && (
        <Button variant="secondary" size="lg" className="h-11 w-full" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </Button>
      )}
    </div>
  );
}

export function CardImage({ url, eager }: { url: string | null; eager?: boolean }) {
  return url ? (
    // Data Dragon art is referenced, never rehosted (Riot's terms), and next/image would copy it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={308}
      height={560}
      loading={eager ? "eager" : "lazy"}
      className="aspect-[308/560] w-full rounded-lg bg-muted object-cover"
    />
  ) : (
    <div aria-hidden className="aspect-[308/560] w-full rounded-lg bg-muted" />
  );
}

/**
 * The visitor's rows, changed here first and saved behind them: every tap lands in `pending`
 * (also in localStorage, so a reload or a closed tab loses nothing) and is sent as the row's
 * new numbers, retried until the database has it. Absolute numbers, so a retry of a save
 * that did arrive changes nothing.
 */
function useCollection(mine: MyCollection) {
  const [rows, setRowsState] = useState(() => new Map<string, Copies>(mine.owned.map((r) => [rowKey(r.printing_id, r.finish, r.condition), r])));
  // Taps faster than React renders build on each other, not on a stale `rows`.
  const latest = useRef(rows);
  const setRows = useCallback((next: Map<string, Copies>) => {
    latest.current = next;
    setRowsState(next);
  }, []);
  const [status, setStatus] = useState("");
  const [waiting, setWaiting] = useState(0);
  const pending = useRef(new Map<string, Copies>());
  const busy = useRef(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const storage = `riftbound-collection-pending:${mine.userId}`;

  const remember = useCallback(() => {
    setWaiting(pending.current.size);
    try {
      if (pending.current.size) localStorage.setItem(storage, JSON.stringify([...pending.current]));
      else localStorage.removeItem(storage);
    } catch {
      // Private mode or a full quota: the taps are still saved while the page is open.
    }
  }, [storage]);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    const supabase = createClient();
    while (pending.current.size) {
      const [key, row] = pending.current.entries().next().value!;
      setStatus(`Saving ${pending.current.size}…`);
      const { printing_id, finish, condition } = parseKey(key);
      const error = await supabase
        .rpc("set_riftbound_copies", {
          p_printing: printing_id,
          p_finish: finish,
          p_condition: condition,
          p_quantity: row.quantity,
          p_for_trade: row.for_trade,
          p_lendable: row.lendable,
        })
        .then(
          (r) => r.error,
          (err: unknown) => err as Error,
        );
      if (error) {
        setStatus(`${pending.current.size} not saved yet, retrying (${error.message})`);
        timer.current = setTimeout(() => void flush(), retryDelay(attempt.current++));
        busy.current = false;
        return;
      }
      attempt.current = 0;
      // A newer tap on the same row stays queued.
      if (pending.current.get(key) === row) pending.current.delete(key);
      remember();
    }
    setStatus("All changes saved");
    busy.current = false;
  }, [remember]);

  // Taps from an earlier visit that never reached the database.
  useEffect(() => {
    let saved: [string, Copies][] = [];
    try {
      saved = JSON.parse(localStorage.getItem(storage) ?? "[]");
    } catch {}
    if (!saved.length) return;
    for (const [key, row] of saved) pending.current.set(key, row);
    setRows(new Map([...latest.current, ...saved]));
    remember();
    void flush();
  }, [storage, remember, flush, setRows]);

  useEffect(() => {
    const online = () => {
      attempt.current = 0;
      void flush();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  const change = (key: string, update: (row: Copies) => Copies) => {
    const row = update(latest.current.get(key) ?? NONE);
    setRows(new Map(latest.current).set(key, row));
    pending.current.set(key, row);
    remember();
    void flush();
  };

  const playset = async (set: string, printings: string[]) => {
    setStatus(`Adding a playset of ${set}…`);
    const { error } = await createClient().rpc("own_riftbound_playset", { p_set: set });
    if (error) return setStatus(`Could not add the playset (${error.message}). Try again.`);
    setRows(applyPlayset(latest.current, printings));
    setStatus(`Playset of ${set} added`);
  };

  const owned = (c: LibraryCard) => {
    const ids = new Set(c.printings.map((p) => p.id));
    let n = 0;
    for (const [key, row] of rows) if (ids.has(parseKey(key).printing_id)) n += row.quantity;
    return n;
  };

  return { rows, status, waiting, change, playset, owned };
}
