"use client";

import { type Collection, Stepper, SyncStatus, useCollection } from "@/components/collection-sync";
import { StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { available, CONDITIONS, copyKey, FINISHES, step } from "@/lib/collection";
import { useState } from "react";

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const FINISH_LABELS: Record<string, string> = { normal: "Normal", foil: "Foil" };

/** A card page's editor: every finish and condition of every printing, with trade and lend counts. */
export function CopiesEditor({ printings, collection }: { printings: { id: string; code: string }[]; collection: Collection }) {
  const { copies, save, waiting, error } = useCollection(collection);
  const [printing, setPrinting] = useState(printings[0]?.id ?? "");
  const [finish, setFinish] = useState("normal");
  const [condition, setCondition] = useState("NM");
  const code = new Map(printings.map((p) => [p.id, p.code]));
  // Rows stepped to 0 stay until the page is left, so a slip of the thumb is one tap to undo.
  const rows = [...copies.values()].filter((c) => code.has(c.printing)).sort((a, b) => copyKey(a).localeCompare(copyKey(b)));
  const add = () => {
    const blank = { printing, finish, condition, quantity: 0, for_trade: 0, lendable: null };
    save(step(copies.get(copyKey(blank)) ?? blank, "quantity", 1, collection.lendAll));
  };
  if (printings.length === 0) return null;
  return (
    <StatCard title="Your copies" description={collection.lends ? "Copies, for trade and to lend" : "Copies and for trade"}>
      <ul className="flex flex-col divide-y">
        {rows.map((c) => {
          const label = [code.get(c.printing), FINISH_LABELS[c.finish], c.condition].join(" · ");
          return (
            <li key={copyKey(c)} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">{label}</span>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["quantity", "Copies", c.quantity],
                    ["for_trade", "For trade", c.for_trade],
                    ...(collection.lends ? [["lendable", "To lend", available(c, true, collection.lendAll)] as const] : []),
                  ] as const
                ).map(([f, name, value]) => (
                  <div key={f} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{name}</span>
                    <Stepper label={`${name}, ${label}`} value={value} onStep={(d) => save(step(c, f, d, collection.lendAll))} />
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {printings.length > 1 && (
          <select aria-label="Printing" value={printing} onChange={(e) => setPrinting(e.target.value)} className={field}>
            {printings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Finish" value={finish} onChange={(e) => setFinish(e.target.value)} className={field}>
          {FINISHES.map((f) => (
            <option key={f} value={f}>
              {FINISH_LABELS[f]}
            </option>
          ))}
        </select>
        <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value)} className={field}>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button variant="secondary" className="h-11" onClick={add}>
          Add a copy
        </Button>
      </div>
      <SyncStatus waiting={waiting} error={error} />
    </StatCard>
  );
}
