"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useState } from "react";

export interface MyDeck {
  id: string;
  name: string;
}

/** One more copy in the deck (a legend becomes its Legend); the reply to show. */
export async function addToDeck(deck: MyDeck, card: { id: string; name: string }): Promise<string> {
  const { error } = await createClient().rpc("add_riftbound_deck_card", { p_deck: deck.id, p_card: card.id });
  return error ? `Not added to ${deck.name} (${error.message}). Try again.` : `${card.name} added to ${deck.name}`;
}

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-64";

/** The card page's Add to deck. */
export function AddToDeck({ card, decks }: { card: { id: string; name: string }; decks: MyDeck[] }) {
  const [deck, setDeck] = useState(decks[0]?.id ?? "");
  const [status, setStatus] = useState("");
  if (!decks.length) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/decks" className="underline hover:text-foreground">
          Make a deck
        </Link>{" "}
        to add this card to it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select aria-label="Deck" value={deck} onChange={(e) => setDeck(e.target.value)} className={field}>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          className="h-11"
          onClick={async () => {
            setStatus("Adding…");
            setStatus(await addToDeck(decks.find((d) => d.id === deck)!, card));
          }}
        >
          Add to deck
        </Button>
      </div>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
