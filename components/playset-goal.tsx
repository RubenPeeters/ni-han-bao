"use client";

import { StatCard } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** A set the goal can cover: its code, name and how many cards a playset of it has. */
export interface GoalSet {
  code: string;
  name: string;
  cards: number;
}

const box = "mt-0.5 size-4 shrink-0 accent-primary";

/**
 * Your own Wishlist tab: a playset goal per set, saved as you tick. "All sets" also covers
 * sets released later; unticking one set then keeps the others, one by one.
 */
export function PlaysetGoal({ sets, all: allSets, chosen: chosenSets }: { sets: GoalSet[]; all: boolean; chosen: string[] }) {
  const router = useRouter();
  const [all, setAll] = useState(allSets);
  const [chosen, setChosen] = useState(new Set(chosenSets));
  const [status, setStatus] = useState("");

  const save = async (set: string | null, on: boolean) => {
    setStatus("Saving…");
    const { error } = await createClient().rpc("set_riftbound_playset_goal", { p_set: set, p_on: on });
    if (error) return setStatus(`Not saved (${error.message}). Try again.`);
    if (set === null) {
      setAll(on);
      setChosen(new Set());
    } else {
      // Off out of "all sets": the database keeps the others chosen, one by one.
      const now = all ? new Set(sets.map((s) => s.code)) : new Set(chosen);
      if (on) now.add(set);
      else now.delete(set);
      if (!on) setAll(false);
      setChosen(now);
    }
    setStatus("Saved");
    router.refresh();
  };

  return (
    <StatCard title="Playset goal" description="3 copies of each card in a set, in any printing or language. Your decks come first.">
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Sets you want a playset of</legend>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => save(null, e.target.checked)} className={box} />
          <span className="flex flex-col">
            <span className="font-medium">All sets</span>
            <span className="text-muted-foreground">Also the sets that come out later.</span>
          </span>
        </label>
        {sets.map((s) => (
          <label key={s.code} className="flex min-h-11 items-start gap-3 py-2 text-sm">
            <input type="checkbox" checked={all || chosen.has(s.code)} onChange={(e) => save(s.code, e.target.checked)} className={box} />
            <span className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-3">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">{s.cards.toLocaleString("en-US")} cards</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status || "Normal numbers only: no alternate art, starred, overnumbered, SP, token or rune printings."}
      </p>
    </StatCard>
  );
}
