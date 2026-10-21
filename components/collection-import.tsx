"use client";

import { StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCollectionCsv, type ImportPreview } from "@/lib/collection-import";
import { allPages } from "@/lib/decks";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

function Rows({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="min-w-0">
      <summary className="flex h-11 cursor-pointer items-center rounded-md text-sm font-medium hover:text-muted-foreground">{title}</summary>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">{children}</ul>
    </details>
  );
}

/** /collection's CSV import: read and previewed here, only the matched rows saved, on confirm. */
export function CollectionImport() {
  const router = useRouter();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const read = async (file: File | undefined) => {
    setPreview(null);
    setSaved(false);
    if (!file) return setStatus("");
    setStatus("Reading…");
    const supabase = createClient();
    const [text, ids] = await Promise.all([
      file.text(),
      allPages((from, to) => supabase.from("riftbound_printings").select("id").order("id").range(from, to)),
    ]);
    if (ids.error) return setStatus(`Could not load the catalogue (${ids.error.message}). Try again.`);
    const known = new Set(ids.data.map((p) => p.id as string));
    setPreview(parseCollectionCsv(text, (id) => known.has(id)));
    setStatus("");
  };

  const save = async (p: ImportPreview) => {
    setSaving(true);
    setStatus("Saving…");
    const { data, error } = await createClient().rpc("import_riftbound_collection", {
      p_rows: p.matched.map(({ printing_id, quantity, want }) => ({ printing_id, quantity, want })),
    });
    setSaving(false);
    if (error) return setStatus(`Not saved (${error.message}). Try again.`);
    const [added] = data as { copies: number; wishes: number }[];
    const skipped = p.unknown.length + p.invalid.length;
    setSaved(true);
    setStatus(
      `Added ${n(added.copies, "copy", "copies")} and ${n(added.wishes, "wishlist entry", "wishlist entries")}.` +
        (skipped ? ` Skipped ${n(skipped, "row")}, listed below.` : ""),
    );
    router.refresh();
  };

  const copies = preview?.matched.reduce((sum, r) => sum + r.quantity, 0) ?? 0;
  const wants = preview?.matched.reduce((sum, r) => sum + r.want, 0) ?? 0;
  return (
    <StatCard title="Import from CSV" description="One row per printing, with card_id, quantity and want_quantity columns.">
      <Input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file to import"
        onChange={(e) => void read(e.target.files?.[0])}
        className="h-11 py-2"
      />
      {preview && !saved && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {n(preview.matched.length, "row")} found in the catalogue: {n(copies, "copy", "copies")} and {n(wants, "wanted card")}.
          </p>
          <p className="text-xs text-muted-foreground">
            These are added to what you have, as normal, near-mint copies in the language you last added cards in, and wanted
            cards to your wishlist (at most 99 each). Importing the same file twice doubles them.
          </p>
          <Button className="h-11 self-start" disabled={saving || copies + wants === 0} onClick={() => void save(preview)}>
            Add {n(copies, "copy", "copies")}
            {wants > 0 && ` and ${n(wants, "wish", "wishes")}`}
          </Button>
        </div>
      )}
      {status && (
        <p aria-live="polite" className="text-sm">
          {status}
        </p>
      )}
      {preview && (
        <div className="flex flex-col">
          {preview.matched.length > 0 && !saved && (
            <Rows title={`Found (${preview.matched.length})`}>
              {preview.matched.map((r) => (
                <li key={r.line} className="break-words">
                  {r.name || r.printing_id}: {r.quantity} owned, {r.want} wanted
                </li>
              ))}
            </Rows>
          )}
          {preview.unknown.length > 0 && (
            <Rows title={`Not in the catalogue, skipped (${preview.unknown.length})`}>
              {preview.unknown.map((r) => (
                <li key={r.line} className="break-words">
                  Line {r.line}: {r.printing_id} {r.name}
                </li>
              ))}
            </Rows>
          )}
          {preview.invalid.length > 0 && (
            <Rows title={`Could not be read, skipped (${preview.invalid.length})`}>
              {preview.invalid.map((r) => (
                <li key={r.line} className="break-all">
                  Line {r.line}: {r.reason}: {r.text}
                </li>
              ))}
            </Rows>
          )}
        </div>
      )}
    </StatCard>
  );
}
