"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/stat-ui";
import { type Collection, Stepper, SyncStatus, useCollection } from "@/components/collection-sync";
import { available, type Copy, copyKey, step } from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useState } from "react";

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
  /** In collector order: the grid's steppers count copies of the first. */
  printings: { id: string; set_code: string }[];
  image_url: string | null;
}

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

// Logged in without Discord: nothing to edit, and the hook still needs its argument.
const NO_COLLECTION: Collection = { me: "", copies: [], lends: false, lendAll: false };

// The copy a tile's stepper counts: the first printing, normal, near mint; the rest is on the card's page.
const tileCopy = (c: LibraryCard, copies: Map<string, Copy>): Copy | null => {
  const printing = c.printings[0]?.id;
  if (!printing) return null;
  const blank = { printing, finish: "normal", condition: "NM", quantity: 0, for_trade: 0, lendable: null };
  return copies.get(copyKey(blank)) ?? blank;
};

/**
 * The library, and with Edit collection on, the editor: search the card in your hand, tap
 * plus. Everything is sent once and filtered here, so search answers on every key.
 */
export function CardGrid({ cards, collection }: { cards: LibraryCard[]; collection: Collection | null }) {
  const { copies, save, merge, waiting, error } = useCollection(collection ?? NO_COLLECTION);
  const [editing, setEditing] = useState(false);
  const [playset, setPlayset] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [domain, setDomain] = useState("");
  const [cost, setCost] = useState("");
  const [set, setSet] = useState("");
  const [limit, setLimit] = useState(PAGE);
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
  const byPrinting = new Map<string, number>();
  for (const k of copies.values()) byPrinting.set(k.printing, (byPrinting.get(k.printing) ?? 0) + k.quantity);
  const owned = (c: LibraryCard) => c.printings.reduce((n, p) => n + (byPrinting.get(p.id) ?? 0), 0);
  const tap = (c: LibraryCard, delta: number) => {
    const copy = tileCopy(c, copies);
    if (copy && collection) save(step(copy, "quantity", delta, collection.lendAll));
  };
  const lend = (c: LibraryCard, on: boolean) => {
    const copy = tileCopy(c, copies);
    if (copy) save({ ...copy, lendable: on ? copy.quantity : 0 });
  };
  const playsetSet = set || (filters[3].options.length === 1 ? filters[3].options[0] : "");
  const addPlayset = async () => {
    setPlayset("Adding…");
    const { error: failed } = await createClient().rpc("riftbound_playset", { set_code: playsetSet });
    if (failed) return setPlayset(`Not saved: ${failed.message}`);
    // What riftbound_playset() wrote: three of each, one legend, never fewer than before.
    merge(
      cards.flatMap((c) => {
        const copy = c.printings[0]?.set_code === playsetSet ? tileCopy(c, copies) : null;
        return copy ? [{ ...copy, quantity: Math.max(copy.quantity, c.type === "Legend" ? 1 : 3) }] : [];
      }),
    );
    setPlayset(`Playset of ${playsetSet} added.`);
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
          // While editing, Enter adds a copy of the only card left: type, Enter, next card.
          onKeyDown={(e) => {
            if (e.key === "Enter" && editing && shown.length === 1) tap(shown[0], 1);
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {shown.length === cards.length
              ? `${cards.length.toLocaleString("en-US")} cards`
              : `${shown.length.toLocaleString("en-US")} of ${cards.length.toLocaleString("en-US")} cards`}
          </p>
          {collection && (
            <Button variant={editing ? "default" : "secondary"} size="sm" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit collection"}
            </Button>
          )}
        </div>
        {editing && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SyncStatus waiting={waiting} error={error} />
            {playsetSet && (
              <Button variant="secondary" size="sm" onClick={addPlayset} disabled={playset === "Adding…"}>
                I own a playset of {playsetSet}
              </Button>
            )}
            {playset && (
              <p aria-live="polite" className="w-full text-xs text-muted-foreground">
                {playset}
              </p>
            )}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState>No card matches. Try fewer filters.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {shown.slice(0, limit).map((c) => (
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
                  {!editing && owned(c) > 0 && <span className="text-xs">You own {owned(c)}</span>}
                </span>
              </Link>
              {editing && collection && <TileEditor card={c} copy={tileCopy(c, copies)} collection={collection} tap={tap} lend={lend} />}
            </li>
          ))}
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

function TileEditor({
  card,
  copy,
  collection,
  tap,
  lend,
}: {
  card: LibraryCard;
  copy: Copy | null;
  collection: Collection;
  tap: (c: LibraryCard, delta: number) => void;
  lend: (c: LibraryCard, on: boolean) => void;
}) {
  if (!copy) return <p className="text-xs text-muted-foreground">No printing to own yet.</p>;
  const lent = available(copy, collection.lends, collection.lendAll) > 0;
  return (
    <div className="flex flex-col gap-2">
      <Stepper label={`Copies of ${card.name}`} value={copy.quantity} onStep={(d) => tap(card, d)} />
      {/* Only for members who lend: plain entry stays one stepper. */}
      {collection.lends && copy.quantity > 0 && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={lent} onChange={(e) => lend(card, e.target.checked)} className="size-4 accent-primary" />
          Available to lend
        </label>
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
