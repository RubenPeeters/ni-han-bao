"use client";

import { findCards, normal, type Card, type Catalogue } from "@/bot/src/card-match";
import { EmptyState, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

/** A hand-added wishlist entry: how many of the card (or only of that printing) in all. */
export interface Wish {
  card_id: string;
  printing_id: string | null;
  quantity: number;
}

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SEARCH_RESULTS = 8;

/** Your own Wishlist tab: add cards by hand and change how many you want, saved as you go. */
export function WishlistEditor({ wishes, catalogue }: { wishes: Wish[]; catalogue: Catalogue }) {
  const router = useRouter();
  const [list, setList] = useState(wishes);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Card | null>(null);
  const [printing, setPrinting] = useState("");
  const [quantity, setQuantity] = useState(1);
  const cards = useMemo(() => new Map(catalogue.cards.map((c) => [c.id, c])), [catalogue]);
  const printings = useMemo(() => Map.groupBy(catalogue.printings, (p) => p.card_id), [catalogue]);
  const codes = useMemo(() => new Map(catalogue.printings.map((p) => [p.id, p.collector_code])), [catalogue]);

  const q = normal(query);
  const found = findCards(catalogue, query).slice(0, SEARCH_RESULTS);

  // An absolute count, so a retried tap cannot count twice; 0 removes the entry.
  const save = async (wish: Wish) => {
    const name = cards.get(wish.card_id)?.name ?? wish.card_id;
    setStatus("Saving…");
    const { error } = await createClient().rpc("set_riftbound_wish", {
      p_card: wish.card_id,
      p_printing: wish.printing_id,
      p_quantity: wish.quantity,
    });
    if (error) return setStatus(`Not saved (${error.message}). Try again.`);
    const same = (w: Wish) => w.card_id === wish.card_id && w.printing_id === wish.printing_id;
    setList((l) => (wish.quantity > 0 ? (l.some(same) ? l.map((w) => (same(w) ? wish : w)) : [...l, wish]) : l.filter((w) => !same(w))));
    setStatus(wish.quantity > 0 ? `${name}: ${wish.quantity} wanted in all` : `${name} removed`);
    router.refresh();
  };

  return (
    <>
      <StatCard title="Add a card" description="Search by name, champion or number (34, OGN-34)">
        <Input
          type="search"
          aria-label="Search cards to add to your wishlist"
          placeholder="Search to add"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
          className="h-11 text-base md:text-base"
        />
        {q && !picked && found.length === 0 && <EmptyState>No card matches.</EmptyState>}
        {!picked && found.length > 0 && (
          <ul className="flex flex-col divide-y">
            {found.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{[c.type, ...c.domains].join(" · ")}</span>
                </span>
                <Button
                  variant="secondary"
                  className="h-11 shrink-0"
                  onClick={() => {
                    setPicked(c);
                    setPrinting("");
                    setQuantity(Math.max(1, list.find((w) => w.card_id === c.id && !w.printing_id)?.quantity ?? 1));
                  }}
                >
                  Pick
                </Button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{picked.name}</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Printing
                <select value={printing} onChange={(e) => setPrinting(e.target.value)} className={field}>
                  <option value="">Any printing</option>
                  {(printings.get(picked.id) ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      Only {p.collector_code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                How many in all
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.min(99, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
                  className="h-11 text-base md:text-base"
                />
              </label>
              <Button
                className="h-11"
                onClick={async () => {
                  await save({ card_id: picked.id, printing_id: printing || null, quantity });
                  setPicked(null);
                  setQuery("");
                }}
              >
                Add to wishlist
              </Button>
            </div>
          </div>
        )}
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {status || "The copies you own count towards it: you want only what is missing."}
        </p>
      </StatCard>

      <StatCard title="Added by hand" description="How many of each you want in all, whatever your decks need">
        {list.length === 0 ? (
          <EmptyState>Nothing added by hand yet.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {list
              .toSorted((a, b) => (cards.get(a.card_id)?.name ?? "").localeCompare(cards.get(b.card_id)?.name ?? ""))
              .map((w) => {
                const name = cards.get(w.card_id)?.name ?? w.card_id;
                return (
                  <li key={`${w.card_id}|${w.printing_id}`} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                    <Link href={`/cards/${w.card_id}`} className="flex min-w-0 flex-1 flex-col rounded-md hover:underline">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {w.printing_id ? `Only ${codes.get(w.printing_id) ?? w.printing_id}` : "Any printing"}
                      </span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="secondary" size="icon" className="size-11" aria-label={`One fewer: ${name}`} onClick={() => save({ ...w, quantity: w.quantity - 1 })}>
                        <Minus aria-hidden />
                      </Button>
                      <span className="w-7 text-center text-lg font-semibold tabular-nums">{w.quantity}</span>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="size-11"
                        aria-label={`One more: ${name}`}
                        disabled={w.quantity >= 99}
                        onClick={() => save({ ...w, quantity: w.quantity + 1 })}
                      >
                        <Plus aria-hidden />
                      </Button>
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </StatCard>
    </>
  );
}
