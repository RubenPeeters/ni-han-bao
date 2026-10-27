"use client";

import { byPrinting, matchesCode, normal, rarityRank } from "@/bot/src/card-match";
import { addToDeck, type MyDeck } from "@/components/add-to-deck";
import { CardThumb } from "@/components/card-thumb";
import { DomainIcon, EnergyBadge, FacetIcon, TypeIcon, type RiftboundIcon } from "@/components/riftbound-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/stat-ui";
import { useCollection } from "@/components/use-collection";
import { CopiesSheet, YourCopies } from "@/components/your-copies";
import {
  cardOrder,
  CONDITIONS,
  FINISHES,
  gridTiles,
  LANGUAGES,
  languageCode,
  NONE,
  PLAYSET,
  rowKey,
  rowsByPrinting,
  shown as countOf,
  step,
  tileCopies,
  type Condition,
  type Finish,
  type Language,
  type Mode,
  type OwnedRow,
  type Sort,
  type View,
} from "@/lib/collection";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  const rowsOf = useMemo(() => rowsByPrinting(collection.rows), [collection.rows]);
  // The tile whose Your copies sheet is open: its card, and its printing in Every printing.
  const [sheet, setSheet] = useState<{ card: LibraryCard; only?: string } | null>(null);
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
            const { chips } = tileCopies(rowsOf, view === "printing" && p ? [p.id] : c.printings.map((x) => x.id), language);
            const open = () => setSheet({ card: c, only: view === "printing" ? p?.id : undefined });
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
                  </span>
                </Link>
                {c.owned > 0 && (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    title="Your copies"
                    onClick={open}
                    className="-mt-2 flex min-h-11 flex-wrap items-center gap-x-1 rounded-md text-left text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.owned.toLocaleString("en-US")} owned
                    {c.elsewhere > 0 && <span className="font-normal text-muted-foreground">· {c.elsewhere.toLocaleString("en-US")} on other printings</span>}
                    {chips.map((x) => (
                      <span key={x.language} className="font-normal text-muted-foreground">
                        · {languageCode(x.language)} {x.copies}
                      </span>
                    ))}
                  </button>
                )}
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
                    <Button
                      variant="ghost"
                      className="h-11 min-w-0 px-2 text-lg font-semibold tabular-nums"
                      aria-haspopup="dialog"
                      aria-label={`${count}: your copies of ${c.name}`}
                      onClick={open}
                    >
                      {count}
                    </Button>
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
      {sheet && (
        <CopiesSheet title={sheet.only ? `${sheet.card.name}, ${sheet.card.printings.find((x) => x.id === sheet.only)?.collector_code}` : sheet.card.name} onClose={() => setSheet(null)}>
          <YourCopies
            cardId={sheet.card.id}
            cardName={sheet.card.name}
            printings={sheet.card.printings}
            only={sheet.only}
            collection={collection}
            userId={mine.userId}
            lendAll={mine.lendAll}
            language={language}
          />
        </CopiesSheet>
      )}
      {shown.length > limit && (
        <Button variant="secondary" size="lg" className="h-11 w-full" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </Button>
      )}
    </div>
  );
}
