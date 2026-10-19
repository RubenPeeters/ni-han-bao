"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/stat-ui";
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

/** The library: everything is sent once and filtered here, so search answers on every key. */
export function CardGrid({ cards }: { cards: LibraryCard[] }) {
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
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {shown.length === cards.length
            ? `${cards.length.toLocaleString("en-US")} cards`
            : `${shown.length.toLocaleString("en-US")} of ${cards.length.toLocaleString("en-US")} cards`}
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyState>No card matches. Try fewer filters.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {shown.slice(0, limit).map((c) => (
            <li key={c.id} className="min-w-0">
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
                </span>
              </Link>
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
