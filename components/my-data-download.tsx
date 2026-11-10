"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { Download } from "lucide-react";
import { useState } from "react";

/** Settings' Download my data: everything stored about the visitor (my_data()), as one JSON file. */
export function MyDataDownload() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const download = async () => {
    setBusy(true);
    setStatus("");
    const { data, error } = await createClient().rpc("my_data");
    setBusy(false);
    if (error || !data) return setStatus("Could not load your data. Try again.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    // en-CA writes the local date as YYYY-MM-DD.
    a.download = `nexus-my-data-${new Date().toLocaleDateString("en-CA")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" className="h-11 self-start" disabled={busy} onClick={() => void download()}>
        <Download aria-hidden />
        Download my data
      </Button>
      {status && (
        <p aria-live="polite" className="text-sm">
          {status}
        </p>
      )}
    </div>
  );
}
