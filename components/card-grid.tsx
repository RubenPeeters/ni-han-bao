"use client";

import { byPrinting, matchesCode, normal, rarityRank } from "@/bot/src/card-match";
import { addToDeck, type MyDeck } from "@/components/add-to-deck";
import { CardThumb } from "@/components/card-thumb";
import { DomainIcon, EnergyBadge, FacetIcon, TypeIcon, type RiftboundIcon } from "@/components/riftbound-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/stat-ui";
import {
  applyPlayset,
  cardOrder,
  CONDITIONS,
  FINISHES,
  gridTiles,
  LANGUAGES,
  NONE,
  ownedByPrinting,
  parseKey,
  PLAYSET,
  retryDelay,
  rowKey,
  shown as countOf,
  step,
  type Condition,
  type Copies,
  type Finish,
  type Language,
  type Mode,
  type OwnedRow,
  type Sort,
  type View,
} from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface LibraryCard {
  id: string;
  name: string;
  type: string | null;
  domains: string[];
  energy: number | null;
  tags: string[];
  sets: string[];
  /** Set and collector order; a tile steps the one `gridTiles` gives it. */
  printings: { id: string; set_code: string; collector_code: string; collector_number: number; rarity: string | null; image_url: string | null }[];
  /** The first printing's image that has one: for a tile whose own printing has none. */
  image_url: string | null;
}

/** The visitor's own collection, for the steppers. */
export interface MyCollection {
  userId: string;
  owned: OwnedRow[];
  lends: boolean;
  lendAll: boolean;
  /** The language last added in: where entry starts. */
  language: Language;
  /** For Add to deck. */
  decks: MyDeck[];
}

const MODES: { value: Mode; label: string }[] = [
  { value: "quantity", label: "Owned" },
  { value: "for_trade", label: "For trade" },
  { value: "lendable", label: "To lend" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "set", label: "Set and number" },
  { value: "name", label: "Name" },
  { value: "cost", label: "Cost" },
  { value: "rarity", label: "Rarity" },
  { value: "owned", label: "Copies owned" },
];
const SORT_STORAGE = "riftbound-cards-sort";
const VIEWS: { value: View; label: string }[] = [
  { value: "card", label: "One per card" },
  { value: "printing", label: "Every printing" },
];
const VIEW_STORAGE = "riftbound-cards-view";

const sorted = <T,>(values: T[]) => [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// Hundreds of tiles at once are a long page and many image loads on a phone.
const PAGE = 24;
const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The library: everything is sent once and filtered here, so search answers on every key. */
export function CardGrid({ cards, icons, mine }: { cards: LibraryCard[]; icons: RiftboundIcon[]; mine: MyCollection }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [domain, setDomain] = useState("");
  const [cost, setCost] = useState("");
  const [set, setSet] = useState("");
  const [sort, setSort] = useState<Sort>("set");
  const [descending, setDescending] = useState(false);
  const [view, setView] = useState<View>("card");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>("quantity");
  const [finish, setFinish] = useState<Finish>("normal");
  const [condition, setCondition] = useState<Condition>("NM");
  const [language, setLanguage] = useState<Language>(mine.language);
  const collection = useCollection(mine);
  const [deckId, setDeckId] = useState("");
  const [added, setAdded] = useState("");
  const deck = mine.decks.find((d) => d.id === deckId);
  const q = normal(query);
  const hit = (p: { collector_code: string }) => !!q && matchesCode(query, p.collector_code);
  // Set and number sorts by the printing found, so the 34s of every set come together, set after set.
  const shown = gridTiles(cards, {
    view,
    set,
    kept: (c) => (!type || c.type === type) && (!domain || c.domains.includes(domain)) && (!cost || String(c.energy) === cost),
    named: (c) => !q || normal(c.name).includes(q) || c.tags.some((t) => normal(t).includes(q)),
    hit,
    owned: collection.perPrinting,
  }).sort(cardOrder(sort, descending, { byPrinting, rarityRank }));
  const total = view === "card" ? cards.length : cards.reduce((n, c) => n + c.printings.length, 0);
  const noun = view === "card" ? "cards" : "printings";
  // Per device, read after the first render so the server's HTML (the default) still matches.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORAGE) ?? "null");
      if (SORTS.some((s) => s.value === saved?.sort)) setSort(saved.sort);
      if (typeof saved?.descending === "boolean") setDescending(saved.descending);
    } catch {}
    try {
      const saved = localStorage.getItem(VIEW_STORAGE);
      if (VIEWS.some((v) => v.value === saved)) setView(saved as View);
    } catch {}
  }, []);
  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE, next);
    } catch {
      // Storage blocked: the choice lasts while the page is open.
    }
  };
  const chooseSort = (next: Sort, nextDescending: boolean) => {
    setSort(next);
    setDescending(nextDescending);
    try {
      localStorage.setItem(SORT_STORAGE, JSON.stringify({ sort: next, descending: nextDescending }));
    } catch {
      // Storage blocked: the choice lasts while the page is open.
    }
  };
  const filters = [
    {
      label: "Type",
      all: "All types",
      value: type,
      set: setType,
      // Riot's tokens have no type: no option of their own, which would also blank "All types".
      options: sorted(cards.flatMap((c) => (c.type ? [c.type] : []))),
      facet: "type",
    },
    { label: "Domain", all: "All domains", value: domain, set: setDomain, options: sorted(cards.flatMap((c) => c.domains)), facet: "domain" },
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
  const tap = (p: LibraryCard["printings"][number] | undefined, delta: number) => {
    if (p) collection.change(rowKey(p.id, finish, condition, language), (row) => step(row, mode, delta, mine.lendAll));
  };
  return (
    <div className="flex flex-col gap-4">
      {/* Stays in reach while scrolling the grid, so the next search is one thumb away. */}
      <div role="search" className="sticky top-0 z-10 -mx-5 flex flex-col gap-2 border-b bg-background/95 px-5 py-3 backdrop-blur">
        <Input
          type="search"
          aria-label="Search cards by name, champion or collector number"
          placeholder="Name, champion or number: 34, OGN-34"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Card in hand, code typed, Enter: one more, without reaching for the mouse.
          onKeyDown={(e) => {
            if (e.key === "Enter" && editing && shown.length === 1) tap(shown[0].printing, e.shiftKey ? -1 : 1);
          }}
          className="h-11 text-base md:text-base"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filters.map((f) => {
            // An <option> cannot hold an image: the chosen value's icon sits in the field instead.
            const facet = f.value && "facet" in f && icons.some((i) => i.facet === f.facet && i.label === f.value) ? f.facet : null;
            return (
              <div key={f.label} className="relative min-w-0">
                {facet && (
                  <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2">
                    <FacetIcon icons={icons} facet={facet} name={f.value} />
                  </span>
                )}
                <select aria-label={f.label} value={f.value} onChange={(e) => f.set(e.target.value)} className={cn(field, facet && "pl-9")}>
                  <option value="">{f.all}</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {f.label === "Cost" ? `${o} energy` : o}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="col-span-2 flex min-w-0 gap-2">
            <select aria-label="Sort" value={sort} onChange={(e) => chooseSort(e.target.value as Sort, descending)} className={field}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              // A toggle keeps one label; pressed says which way.
              aria-label="Descending"
              title={descending ? "Descending" : "Ascending"}
              aria-pressed={descending}
              onClick={() => chooseSort(sort, !descending)}
            >
              {descending ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
            </Button>
          </div>
        </div>
        {editing && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as Language)} className={field}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {shown.length === total
              ? `${total.toLocaleString("en-US")} ${noun}`
              : `${shown.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`}
            {collection.status && ` · ${collection.status}`}
            {added && ` · ${added}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {mine.decks.length > 0 && (
              <select
                aria-label="Add to deck"
                value={deckId}
                onChange={(e) => setDeckId(e.target.value)}
                className="h-9 min-w-0 max-w-48 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Add to deck…</option>
                {mine.decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {editing &&
              playsetOf &&
              [PLAYSET, 2 * PLAYSET].map((copies) => (
                <Button
                  key={copies}
                  variant="secondary"
                  size="sm"
                  // The database tops up from what it has, so the taps go first.
                  disabled={collection.waiting > 0}
                  onClick={() =>
                    collection.playset(
                      playsetOf,
                      cards.flatMap((c) => c.printings.filter((p) => p.set_code === playsetOf)),
                      language,
                      copies,
                    )
                  }
                >
                  I own {copies === PLAYSET ? "a playset" : "2 playsets"} of {playsetOf}
                </Button>
              ))}
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
      <div role="group" aria-label="Tiles" className="flex gap-1">
        {VIEWS.map((v) => (
          <Button key={v.value} variant={view === v.value ? "default" : "ghost"} size="sm" className="h-11" aria-pressed={view === v.value} onClick={() => chooseView(v.value)}>
            {v.label}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState>No card matches. Try fewer filters.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {shown.slice(0, limit).map((c) => {
            const p = c.printing;
            const count = p ? countOf(collection.rows.get(rowKey(p.id, finish, condition, language)) ?? NONE, mode, mine.lendAll) : 0;
            return (
              <li key={p?.id ?? c.id} className="flex min-w-0 flex-col gap-2">
                <Link
                  href={`/cards/${c.id}`}
                  className="flex flex-col gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80"
                >
                  <CardThumb url={p?.image_url ?? c.image_url} name={c.name} landscape={c.type === "Battlefield"} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium" title={c.name}>
                      {c.name}
                    </span>
                    {/* Always one line tall, so a tile without a printing lines up with its row. */}
                    <span className="h-4 truncate text-xs text-muted-foreground tabular-nums">{p?.collector_code}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {c.type && <TypeIcon icons={icons} type={c.type} />}
                      {c.energy !== null && <EnergyBadge value={c.energy} />}
                      {c.domains.map((d) => (
                        <DomainIcon key={d} icons={icons} domain={d} />
                      ))}
                    </span>
                    {c.owned > 0 && (
                      <span className="text-xs font-medium">
                        {c.owned.toLocaleString("en-US")} owned
                        {c.elsewhere > 0 && <span className="font-normal text-muted-foreground"> · {c.elsewhere.toLocaleString("en-US")} on other printings</span>}
                      </span>
                    )}
                  </span>
                </Link>
                {deck && (
                  <Button
                    variant="secondary"
                    className="mt-auto h-11 w-full"
                    aria-label={`Add ${c.name} to ${deck.name}`}
                    onClick={async () => setAdded(await addToDeck(deck, c))}
                  >
                    <Plus aria-hidden />
                    Add to deck
                  </Button>
                )}
                {editing && p && (
                  <div className="mt-auto flex items-center justify-between gap-1">
                    <Button variant="secondary" size="icon" className="size-11" aria-label={`One fewer: ${c.name}`} disabled={count === 0} onClick={() => tap(p, -1)}>
                      <Minus aria-hidden />
                    </Button>
                    <span className="min-w-0 text-center text-lg font-semibold tabular-nums">{count}</span>
                    <Button variant="secondary" size="icon" className="size-11" aria-label={`One more: ${c.name}`} onClick={() => tap(p, 1)}>
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

/**
 * The visitor's rows, changed here first and saved behind them: every tap lands in `pending`
 * (also in localStorage, so a reload or a closed tab loses nothing) and is sent as the row's
 * new numbers, retried until the database has it. Absolute numbers, so a retry of a save
 * that did arrive changes nothing.
 */
function useCollection(mine: MyCollection) {
  const [rows, setRowsState] = useState(() => new Map<string, Copies>(mine.owned.map((r) => [rowKey(r.printing_id, r.finish, r.condition, r.language), r])));
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
      const { printing_id, finish, condition, language } = parseKey(key);
      const error = await supabase
        .rpc("set_riftbound_copies", {
          p_printing: printing_id,
          p_finish: finish,
          p_condition: condition,
          p_language: language,
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

  const playset = async (set: string, printings: LibraryCard["printings"], language: Language, copies: number) => {
    const what = copies === PLAYSET ? "a playset" : "2 playsets";
    setStatus(`Adding ${what} of ${set}…`);
    const { error } = await createClient().rpc("own_riftbound_playset", { p_set: set, p_language: language, p_copies: copies });
    if (error) return setStatus(`Could not add ${what} (${error.message}). Try again.`);
    setRows(applyPlayset(latest.current, printings, language, copies));
    setStatus(`Added ${what} of ${set}`);
  };

  // Once per change, not once per card: the Copies owned sort asks for every card.
  const perPrinting = useMemo(() => ownedByPrinting(rows), [rows]);

  return { rows, status, waiting, change, playset, perPrinting };
}
