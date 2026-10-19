"use client";

import { type Copy, copyKey, isPermanent, retryDelay } from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

/** What the collection editors get from the server: the visitor's rows and lending setting. */
export interface Collection {
  me: string;
  copies: Copy[];
  lends: boolean;
  lendAll: boolean;
}

/**
 * The visitor's copies, saved as they change. Every change is the row's whole new state, so a
 * retry cannot count a tap twice; unsaved changes wait in localStorage (per Discord user), so
 * a reload or a dropped connection loses none, and are retried until the database has them.
 */
export function useCollection({ me, copies: initial }: Collection) {
  const [copies, setCopies] = useState(() => new Map(initial.map((c) => [copyKey(c), c])));
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const storage = `riftbound-pending:${me}`;
  const pending = useRef(new Map<string, Copy>());
  const inFlight = useRef(new Set<string>());
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The next page's editor takes over the stored queue; a request answering after unmount must not overwrite it.
  const mounted = useRef(true);

  const persist = useCallback(() => {
    setWaiting(pending.current.size);
    try {
      localStorage.setItem(storage, JSON.stringify([...pending.current.values()]));
    } catch {
      // Private mode or full storage: the queue still lives in memory for this visit.
    }
  }, [storage]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const supabase = createClient();
    for (const [key, sent] of pending.current) {
      if (inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      void supabase
        .rpc("riftbound_collection_set", {
          printing: sent.printing,
          finish: sent.finish,
          condition: sent.condition,
          quantity: sent.quantity,
          for_trade: sent.for_trade,
          lendable: sent.lendable,
        })
        .then(({ error: failed }) => {
          inFlight.current.delete(key);
          if (!mounted.current) return;
          if (failed && !isPermanent(failed)) {
            timer.current = setTimeout(flush, retryDelay(attempt.current++));
            return;
          }
          if (failed) setError(failed.message);
          else attempt.current = 0;
          // A tap made while this was on its way is sent next.
          if (pending.current.get(key) === sent) pending.current.delete(key);
          persist();
          if (pending.current.has(key)) flush();
        });
    }
  }, [persist]);

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storage) ?? "[]") as Copy[];
      for (const c of saved) pending.current.set(copyKey(c), c);
    } catch {
      // Unreadable: nothing to resend.
    }
    if (pending.current.size) {
      // Taps from an earlier visit win over the server's copy.
      setCopies((prev) => new Map([...prev, ...pending.current]));
      persist();
      flush();
    }
    window.addEventListener("online", flush);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", flush);
      clearTimeout(timer.current);
    };
  }, [storage, flush, persist]);

  const save = useCallback(
    (c: Copy) => {
      const key = copyKey(c);
      setCopies((prev) => new Map(prev).set(key, c));
      pending.current.set(key, c);
      persist();
      flush();
    },
    [flush, persist],
  );

  /** Rows the server has already written (a playset): shown, and replacing any older tap. */
  const merge = useCallback(
    (rows: Copy[]) => {
      setCopies((prev) => new Map([...prev, ...rows.map((c) => [copyKey(c), c] as const)]));
      for (const c of rows) if (pending.current.has(copyKey(c))) pending.current.set(copyKey(c), c);
      persist();
    },
    [persist],
  );

  return { copies, save, merge, waiting, error };
}

export function SyncStatus({ waiting, error }: { waiting: number; error: string | null }) {
  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      {error ? `Not saved: ${error}` : waiting ? `Saving ${waiting} ${waiting === 1 ? "change" : "changes"}…` : "All changes saved"}
    </p>
  );
}

/** − count +, big enough for thumbs; the buttons are plain buttons, so Tab and Enter work too. */
export function Stepper({ label, value, onStep }: { label: string; value: number; onStep: (delta: number) => void }) {
  const button =
    "flex size-11 shrink-0 items-center justify-center rounded-md border border-input bg-background text-lg font-medium hover:bg-secondary active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <button type="button" aria-label={`${label}: one less`} disabled={value === 0} onClick={() => onStep(-1)} className={button}>
        −
      </button>
      <output className="min-w-8 text-center font-medium tabular-nums">{value}</output>
      <button type="button" aria-label={`${label}: one more`} onClick={() => onStep(1)} className={button}>
        +
      </button>
    </div>
  );
}
