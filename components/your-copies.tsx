"use client";

import type { MyCollection } from "@/components/card-grid";
import { Button } from "@/components/ui/button";
import { useCollection, type Collection } from "@/components/use-collection";
import {
  CONDITIONS,
  deckCopies,
  FINISHES,
  LANGUAGES,
  languageCode,
  rowKey,
  rowsByPrinting,
  shown,
  step,
  tileCopies,
  type Condition,
  type DeckHold,
  type Finish,
  type Language,
  type Mode,
} from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const STEPPERS: { mode: Mode; label: string }[] = [
  { mode: "quantity", label: "owned" },
  { mode: "for_trade", label: "for trade" },
  { mode: "lendable", label: "to lend" },
];
const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Props {
  cardId: string;
  cardName: string;
  /** Every printing of the card: decks hold copies of a card, whichever printing. */
  printings: { id: string; collector_code: string }[];
  /** The printing to list and add, for a tile of one printing; else all of them. */
  only?: string;
  collection: Collection;
  userId: string;
  lendAll: boolean;
  /** Where Add starts. */
  language: Language;
}

/**
 * Your copies: one row per collection row of the card, with steppers for owned, for trade
 * and to lend, and what decks not for lending and open loans keep. Saves go through the
 * collection's retrying queue.
 */
export function YourCopies({ cardId, cardName, printings, only, collection, userId, lendAll, language }: Props) {
  const ids = printings.map((p) => p.id);
  const all = tileCopies(rowsByPrinting(collection.rows), ids, language).rows;
  const rows = only ? all.filter((r) => r.printing_id === only) : all;
  // Read once per opening: loans and decks change elsewhere, not from here.
  const [kept, setKept] = useState<{ lent: Map<string, number>; decks: DeckHold[] } | null | "error">(null);
  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.rpc("my_riftbound_lend_options", { p_cards: [cardId] }),
      supabase
        .from("riftbound_decks")
        .select("name, language, legend_id, cards:riftbound_deck_cards(quantity)")
        .eq("user_id", userId)
        .eq("not_for_lending", true)
        .eq("cards.card_id", cardId)
        .order("name"),
    ]).then(([options, decks]) => {
      if (options.error || decks.error) return setKept("error");
      const lent = new Map(
        (options.data as { printing_id: string; finish: string; condition: string; language: string; lent: number }[]).map((o) => [
          rowKey(o.printing_id, o.finish, o.condition, o.language),
          o.lent,
        ]),
      );
      const holds = (decks.data as { name: string; language: string; legend_id: string | null; cards: { quantity: number }[] }[])
        .map((d) => ({ name: d.name, language: d.language, copies: Number(d.legend_id === cardId) + d.cards.reduce((n, c) => n + c.quantity, 0) }))
        .filter((d) => d.copies > 0);
      setKept({ lent, decks: holds });
    }, () => setKept("error"));
  }, [cardId, userId]);
  const held = kept && kept !== "error" ? deckCopies(all, kept.lent, kept.decks) : null;
  const code = new Map(printings.map((p) => [p.id, p.collector_code]));
  const choices = only ? printings.filter((p) => p.id === only) : printings;
  const [printing, setPrinting] = useState(only ?? printings[0]?.id ?? "");
  const [addLanguage, setAddLanguage] = useState<Language>(language);
  const [finish, setFinish] = useState<Finish>("normal");
  const [condition, setCondition] = useState<Condition>("NM");
  const change = (key: string, mode: Mode, delta: number) => collection.change(key, (row) => step(row, mode, delta, lendAll));

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No copies yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((r) => {
            const decks = held?.get(r.key) ?? [];
            const label = [
              ...(choices.length > 1 ? [code.get(r.printing_id)] : []),
              languageCode(r.language),
              r.finish,
              r.condition,
            ].join(" · ");
            return (
              <li key={r.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium tabular-nums">{label}</h3>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {kept === null
                      ? "Loading decks and loans…"
                      : kept === "error"
                        ? "Decks and loans could not load"
                        : [
                            decks.length ? decks.map((d) => `${d.copies} in ${d.name}`).join(" · ") : "0 in decks",
                            `${kept.lent.get(r.key) ?? 0} out on loan`,
                          ].join(" · ")}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {STEPPERS.map(({ mode, label: what }) => {
                    const n = shown(r, mode, lendAll);
                    return (
                      <div key={mode} className="flex items-center justify-between gap-1">
                        <span className="text-xs text-muted-foreground sm:hidden">{what}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="size-11"
                            aria-label={`One fewer ${what}: ${cardName}, ${label}`}
                            disabled={n === 0}
                            onClick={() => change(r.key, mode, -1)}
                          >
                            <Minus aria-hidden />
                          </Button>
                          <span className="flex min-w-12 flex-col items-center leading-tight">
                            <span className="text-base font-semibold tabular-nums">{n}</span>
                            <span className="hidden text-xs text-muted-foreground sm:block">{what}</span>
                          </span>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="size-11"
                            aria-label={`One more ${what}: ${cardName}, ${label}`}
                            // For trade and to lend never exceed the copies.
                            disabled={mode !== "quantity" && n >= r.quantity}
                            onClick={() => change(r.key, mode, 1)}
                          >
                            <Plus aria-hidden />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (printing) change(rowKey(printing, finish, condition, addLanguage), "quantity", 1);
        }}
      >
        <h3 className="text-sm font-medium">Add copies in another language, finish or condition</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
          {choices.length > 1 && (
            <select aria-label="Printing" value={printing} onChange={(e) => setPrinting(e.target.value)} className={field}>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.collector_code}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Language" value={addLanguage} onChange={(e) => setAddLanguage(e.target.value as Language)} className={field}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
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
          <Button type="submit" variant="secondary" className="h-11" disabled={!printing}>
            <Plus aria-hidden />
            Add a copy
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Your copies as a sheet over the Cards grid: a modal dialog, closed by Escape, the X or the backdrop. */
export function CopiesSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="your-copies-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-background/80 sm:m-auto sm:max-w-2xl sm:rounded-xl"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="your-copies-title" className="text-lg font-semibold">
              Your copies
            </h2>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Close" onClick={() => ref.current?.close()}>
            <X aria-hidden />
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** The card page's Your copies: its own queue over the visitor's rows of this card. */
export function CardCopies({ mine, ...props }: Omit<Props, "collection" | "userId"> & { mine: Pick<MyCollection, "userId" | "owned"> }) {
  const collection = useCollection(mine);
  return (
    <>
      <YourCopies {...props} collection={collection} userId={mine.userId} />
      {collection.status && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {collection.status}
        </p>
      )}
    </>
  );
}
