"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { collectionCsv, collectionDeckList, type ExportCard, type ExportPrinting, type ExportRow } from "@/lib/collection-export";
import { allPages } from "@/lib/decks";
import { createClient } from "@/lib/supabase/client";
import { ClipboardCopy, Download } from "lucide-react";
import { useState } from "react";

type Loaded = { rows: ExportRow[]; printings: Map<string, ExportPrinting>; cards: Map<string, ExportCard> };

/** /collection's Export menu: the whole collection, read when the menu opens so edits made on the grid are in it. */
export function CollectionExport() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState("");

  const load = async () => {
    setLoaded(null);
    setStatus("");
    const supabase = createClient();
    const [rows, printings, cards] = await Promise.all([
      // RLS returns the visitor's own rows only.
      allPages((from, to) =>
        supabase.from("riftbound_collection").select("printing_id, finish, condition, language, quantity").order("printing_id").order("finish").order("condition").order("language").range(from, to),
      ),
      allPages((from, to) => supabase.from("riftbound_printings").select("id, card_id, set_code, rarity").order("id").range(from, to)),
      allPages((from, to) => supabase.from("riftbound_cards").select("id, name, type, tags").order("id").range(from, to)),
    ]);
    if (rows.error || printings.error || cards.error) return setStatus("Could not load your collection. Try again.");
    setLoaded({
      rows: rows.data as ExportRow[],
      printings: new Map((printings.data as ExportPrinting[]).map((p) => [p.id, p])),
      cards: new Map((cards.data as ExportCard[]).map((c) => [c.id, c])),
    });
  };

  const copy = async ({ rows, printings, cards }: Loaded) => {
    try {
      await navigator.clipboard.writeText(collectionDeckList(rows, printings, cards));
      setStatus("Copied.");
    } catch {
      setStatus("Could not copy: your browser blocked it.");
    }
  };

  const download = ({ rows, printings, cards }: Loaded) => {
    const url = URL.createObjectURL(new Blob([collectionCsv(rows, printings, cards)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    // en-CA writes the local date as YYYY-MM-DD.
    a.download = `collection-${new Date().toLocaleDateString("en-CA")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ready = loaded && loaded.rows.length > 0 ? loaded : null;
  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void load()}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11">
            <Download aria-hidden />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-h-11" disabled={!ready} onSelect={() => ready && void copy(ready)}>
            <ClipboardCopy aria-hidden />
            Copy as deck list
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" disabled={!ready} onSelect={() => ready && download(ready)}>
            <Download aria-hidden />
            Download CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {status && (
        // Its own line of the header's wrapping row, so a long message does not shift the buttons.
        <p aria-live="polite" className="w-full text-sm">
          {status}
        </p>
      )}
    </>
  );
}
