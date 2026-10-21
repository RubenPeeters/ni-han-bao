"use client";

import { pickCopies, type CopyRow, type Wanted } from "@/bot/src/lend-copies";
import { StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The owner's Lending card on a deck page: Not for lending, and Lend this deck as one loan, as /lend deck does. */
export function DeckLending({
  deckId,
  notForLending,
  wanted,
  members,
}: {
  deckId: string;
  notForLending: boolean;
  /** The deck as saved, per card; or why it cannot be lent. */
  wanted: Wanted[] | string;
  /** Members of the owner's servers who are not hidden, to lend to. */
  members: { user_id: string; display_name: string }[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [loan, setLoan] = useState<{ id: number; borrower: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setHeld = async (held: boolean) => {
    setBusy(true);
    const { error } = await createClient().rpc("set_riftbound_deck_lending", { p_deck: deckId, p_not_for_lending: held });
    setBusy(false);
    setStatus(error ? `Not saved (${error.message}). Try again.` : "");
    router.refresh();
  };

  const lend = async (form: FormData) => {
    if (typeof wanted === "string") return;
    setBusy(true);
    setLoan(null);
    setStatus("Lending…");
    const supabase = createClient();
    const options = await supabase.rpc("my_riftbound_lend_options", { p_cards: wanted.map((w) => w.card.id) });
    const picked = options.error ? `Not lent (${options.error.message}). Try again.` : pickCopies(options.data as CopyRow[], wanted);
    if (typeof picked === "string") {
      setBusy(false);
      return setStatus(picked);
    }
    const borrower = String(form.get("borrower"));
    const { data, error } = await supabase.rpc("lend_my_riftbound_deck", {
      p_deck: deckId,
      p_borrower: borrower,
      p_due: String(form.get("due") ?? "") || null,
      p_cards: picked.cards,
    });
    setBusy(false);
    if (error) return setStatus(`Not lent (${error.message}).`);
    setLoan({ id: data as number, borrower });
    setStatus(
      picked.unmarked > 0
        ? `${picked.unmarked} of the copies ${picked.unmarked === 1 ? "is" : "are"} not marked to lend, or held by a deck not for lending. Lent anyway.`
        : "",
    );
  };

  const today = new Date().toISOString().slice(0, 10);
  return (
    <StatCard title="Lending" description="Lend the whole deck as one loan, or keep its cards from being lent">
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id="deck-not-for-lending"
          checked={notForLending}
          disabled={busy}
          onCheckedChange={(v) => setHeld(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="deck-not-for-lending" className="flex flex-col gap-1">
          <span>Not for lending</span>
          <span className="text-xs font-normal text-muted-foreground">
            Its cards are never offered to lend, whatever your per-card counts say, and the deck cannot be lent.
          </span>
        </Label>
      </div>
      {!notForLending && (
        <form action={lend} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Lend this deck to
              <select name="borrower" required defaultValue="" className={field}>
                <option value="" disabled>
                  Pick a member
                </option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Due back (optional)
              <input type="date" name="due" min={today} className={field} />
            </label>
          </div>
          {typeof wanted === "string" && <p className="text-sm text-muted-foreground">{wanted}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-11" disabled={busy || typeof wanted === "string" || members.length === 0}>
              Lend deck
            </Button>
            <p aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
              {loan !== null && (
                <>
                  <Link href={`/u/${loan.borrower}/loans`} className="underline">
                    Recorded loan #{loan.id}
                  </Link>
                  : they confirm it on their My loans page.{" "}
                </>
              )}
              {status || (loan === null && "The deck as saved: one loan, one due date, one confirmation. Also with /lend deck in Discord.")}
            </p>
          </div>
        </form>
      )}
    </StatCard>
  );
}
