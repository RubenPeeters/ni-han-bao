"use client";

import type { LibraryCard, MyCollection } from "@/components/card-grid";
import { applyPlayset, NONE, ownedByPrinting, parseKey, PLAYSET, retryDelay, rowKey, type Copies, type Language } from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The visitor's rows, changed here first and saved behind them: every tap lands in `pending`
 * (also in localStorage, so a reload or a closed tab loses nothing) and is sent as the row's
 * new numbers, retried until the database has it. Absolute numbers, so a retry of a save
 * that did arrive changes nothing.
 */
export function useCollection(mine: Pick<MyCollection, "userId" | "owned">) {
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

export type Collection = ReturnType<typeof useCollection>;
