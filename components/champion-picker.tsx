"use client";

import { setFavouriteChampion } from "@/app/u/[userId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Champion } from "@/lib/ddragon";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useState, useTransition } from "react";

// As the bot matches a typed name: case, accents, spaces and punctuation ignored.
const normal = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The favourite champion: one tap on an icon saves it, a tap on the chosen one (or Clear) clears it. */
export function ChampionPicker({ champions, value }: { champions: Champion[]; value: string | null }) {
  const [chosen, setChosen] = useState(value);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  const [pending, startTransition] = useTransition();
  const current = champions.find((c) => c.id === chosen);
  const q = normal(query);
  const shown = champions.filter((c) => normal(c.name).includes(q) || normal(c.id).includes(q));

  function choose(id: string | null) {
    const before = chosen;
    setChosen(id);
    setStatus(null);
    startTransition(async () => {
      try {
        await setFavouriteChampion(id);
        setStatus("saved");
      } catch {
        setChosen(before);
        setStatus("failed");
      }
    });
  }

  if (champions.length === 0) {
    return <p className="text-sm text-muted-foreground">Could not load the champions. Try again in a minute.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
        {current ? (
          <>
            {/* Riot's CDN serves them small already; next/image would need a remote pattern. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.icon} alt="" width={40} height={40} className="size-10 shrink-0 rounded-md bg-muted" />
            <span className="font-medium">{current.name}</span>
            <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => choose(null)}>
              Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">No favourite yet: tap one below.</span>
        )}
        <span role="status" className="flex items-center gap-1 text-muted-foreground">
          {pending ? (
            "Saving…"
          ) : status === "saved" ? (
            <>
              <Check aria-hidden className="size-4 text-primary" /> Saved
            </>
          ) : (
            status === "failed" && <span className="text-destructive">Not saved. Try again.</span>
          )}
        </span>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Search champions
        <Input
          type="search"
          placeholder="Ahri, Wukong…"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 text-base md:text-base"
        />
      </label>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No champion called that.</p>
      ) : (
        // Scrolls inside, so ~170 champions do not push the rest of Settings far down.
        <ul aria-label="Champions" className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1 overflow-y-auto rounded-md border p-1">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={c.id === chosen}
                disabled={pending}
                onClick={() => choose(c.id === chosen ? null : c.id)}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-md p-1 text-xs transition-colors hover:bg-secondary disabled:opacity-60",
                  c.id === chosen && "bg-secondary ring-2 ring-primary",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.icon} alt="" width={48} height={48} loading="lazy" className="size-12 rounded-md bg-muted" />
                <span className="w-full truncate text-center">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
