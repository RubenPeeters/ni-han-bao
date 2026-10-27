"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { championMatches, type Champion } from "@/lib/ddragon";
import { cn } from "@/lib/utils";
import { useActionState, useState } from "react";

/** Settings' favourite champion: one tap on an icon saves it, Clear removes it. */
export function ChampionPicker({
  champions,
  value,
  action,
}: {
  champions: Champion[];
  value: string | null;
  action: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  // The action throws on failure (the error page then shows), so what it returns was saved.
  const [chosen, submit, pending] = useActionState(async (_: string | null, formData: FormData) => {
    await action(formData);
    return String(formData.get("champion")) || null;
  }, value);
  const current = champions.find((c) => c.id === chosen);
  const shown = champions.filter((c) => championMatches(c, query));
  return (
    <div className="flex flex-col gap-3">
      {/* The search sits outside the form: Enter in it must not choose the first icon. */}
      <Input
        type="search"
        aria-label="Search champions"
        placeholder="Search champions"
        enterKeyHint="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 text-base md:text-base"
      />
      <form action={submit} className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center gap-3 text-sm">
          {current && (
            // Riot's CDN serves them small already; next/image would need a remote pattern.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.icon} alt="" width={32} height={32} className="shrink-0 rounded-sm bg-muted" />
          )}
          <p role="status" className="min-w-0 flex-1 truncate">
            {pending ? "Saving…" : chosen ? <span className="font-medium">{current?.name ?? chosen}</span> : <span className="text-muted-foreground">None chosen</span>}
          </p>
          {chosen && (
            <Button type="submit" name="champion" value="" variant="outline" disabled={pending} className="h-11">
              Clear
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No champion matches.</p>
        ) : (
          <ul className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2 overflow-y-auto p-0.5">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="submit"
                  name="champion"
                  value={c.id}
                  aria-label={c.name}
                  aria-pressed={c.id === chosen}
                  title={c.name}
                  disabled={pending}
                  className={cn(
                    "block size-11 overflow-hidden rounded-md ring-offset-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
                    c.id === chosen && "ring-2 ring-primary ring-offset-2",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.icon} alt="" width={44} height={44} loading="lazy" className="size-11 bg-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
