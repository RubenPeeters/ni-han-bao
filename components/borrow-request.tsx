"use client";

import { pickCopies, type CopyRow, type LoanCard } from "@/bot/src/lend-copies";
import { Checkboxes } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import { languageName, LANGUAGES } from "@/lib/collection";
import { createClient } from "@/lib/supabase/client";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** A card a request asks for: how many (prefilled) and at most how many the lender has to lend. */
export interface AskCard {
  card_id: string;
  name: string;
  count: number;
  max: number;
}

/**
 * Ask to borrow: a button that opens the request form for one lender. The database checks
 * the lender has the copies to lend in those languages, and that no request for a card is open.
 */
export function AskToBorrow({
  lender,
  cards,
  languages,
  label = "Ask to borrow",
}: {
  lender: { id: string; name: string };
  cards: AskCard[];
  /** Prefilled: borrowLanguages(). */
  languages: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" className="h-11 shrink-0" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <AskForm lender={lender} cards={cards} languages={languages} onClose={() => setOpen(false)} />}
    </>
  );
}

function AskForm({ lender, cards, languages, onClose }: { lender: { id: string; name: string }; cards: AskCard[]; languages: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [status, setStatus] = useState("");
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (form: FormData) => {
    const wanted = cards
      .map((c) => ({ card_id: c.card_id, quantity: Number(form.get(`count-${c.card_id}`) ?? 0) }))
      .filter((c) => c.quantity > 0);
    if (wanted.length === 0) return setStatus("Ask for at least one card.");
    setBusy(true);
    setStatus("Sending…");
    const { data, error } = await createClient().rpc("ask_to_borrow", {
      p_lender: lender.id,
      p_cards: wanted,
      p_languages: form.getAll("languages").map(String),
      p_wanted_by: String(form.get("wanted_by") ?? "") || null,
      p_note: String(form.get("note") ?? ""),
    });
    setBusy(false);
    if (error) return setStatus(`Not sent: ${error.message}.`);
    setSent(data as number);
    setStatus("");
  };

  const today = new Date().toISOString().slice(0, 10);
  return (
    <dialog
      ref={ref}
      aria-labelledby="ask-to-borrow-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-background/80 sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="ask-to-borrow-title" className="text-lg font-semibold">
              Ask to borrow
            </h2>
            <p className="truncate text-xs text-muted-foreground">From {lender.name}: the bot sends them your request in a DM.</p>
          </div>
          <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Close" onClick={() => ref.current?.close()}>
            <X aria-hidden />
          </Button>
        </div>
        {sent !== null ? (
          <p aria-live="polite" className="text-sm">
            Sent as request #{sent}. You see their answer on{" "}
            <Link href="/loans" className="underline">
              My loans
            </Link>
            , where you can also cancel it.
          </p>
        ) : (
          <form action={ask} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Cards</legend>
              {cards.map((c) => (
                <label key={c.card_id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">{c.name}</span>
                  <input
                    type="number"
                    name={`count-${c.card_id}`}
                    min={0}
                    max={c.max}
                    defaultValue={c.count}
                    aria-label={`How many ${c.name}`}
                    className={`${field} w-20 shrink-0 tabular-nums`}
                  />
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col">
              <legend className="mb-1 text-sm font-medium">Languages I accept</legend>
              <Checkboxes name="languages" options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} value={languages} />
            </fieldset>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Wanted by (optional)
              <input type="date" name="wanted_by" min={today} className={field} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Note (optional)
              <textarea
                name="note"
                maxLength={300}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" className="h-11" disabled={busy}>
                Send request
              </Button>
              <p aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
                {status}
              </p>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

/** A request as my_borrow_requests() returns it, what the actions need of it. */
export interface RequestToAnswer {
  id: number;
  languages: string[];
  cards: { card_id: string; name: string; quantity: number }[];
}

/**
 * The lender's Accept and Decline on /loans, as the DM's buttons: Accept picks copies in the
 * accepted languages, available to lend first (pickCopies(), as /lend), and records the loan on Confirm.
 */
export function AnswerRequest({ request }: { request: RequestToAnswer }) {
  const router = useRouter();
  const [picked, setPicked] = useState<{ cards: LoanCard[]; unmarked: number; cardOf: Map<string, string> } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(request.cards.map((c) => [c.card_id, c.name]));

  const accept = async () => {
    setBusy(true);
    const supabase = createClient();
    const options = await supabase.rpc("my_riftbound_lend_options", { p_cards: request.cards.map((c) => c.card_id) });
    setBusy(false);
    if (options.error) return setStatus(`Could not pick your copies (${options.error.message}). Try again.`);
    // pickCopies() reads a card's id and name only.
    const wanted = request.cards.map((c) => ({ card: { id: c.card_id, name: c.name } as Parameters<typeof pickCopies>[1][number]["card"], count: c.quantity }));
    const result = pickCopies(options.data as CopyRow[], wanted, request.languages);
    if (typeof result === "string") return setStatus(result);
    setPicked({ ...result, cardOf: new Map((options.data as CopyRow[]).map((r) => [r.printing_id, r.card_id])) });
    setStatus("");
  };

  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    const { data, error } = await createClient().rpc("accept_my_borrow_request", { p_request: request.id, p_due: null, p_cards: picked.cards });
    setBusy(false);
    if (error) return setStatus(`Not lent (${error.message}).`);
    setStatus(`Recorded as loan #${data}.`);
    setPicked(null);
    router.refresh();
  };

  const decline = async (form: FormData) => {
    setBusy(true);
    const { data, error } = await createClient().rpc("decline_my_borrow_request", { p_request: request.id, p_note: String(form.get("note") ?? "") });
    setBusy(false);
    if (error || data !== "ok") return setStatus(error ? `Not declined (${error.message}).` : "This request was answered or cancelled meanwhile.");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 pl-11">
      {picked ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">Lend these copies?</p>
          <ul className="flex flex-col gap-1">
            {picked.cards.map((c) => (
              <li key={`${c.printing_id} ${c.finish} ${c.condition} ${c.language}`} className="break-words">
                <span className="tabular-nums">{c.quantity} ×</span>{" "}
                {[names.get(picked.cardOf.get(c.printing_id) ?? ""), languageName(c.language), c.finish === "foil" && "foil", c.condition !== "NM" && c.condition]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
          {picked.unmarked > 0 && (
            <p className="text-xs text-muted-foreground">
              {picked.unmarked} of these {picked.unmarked === 1 ? "is" : "are"} not marked to lend, or held by a deck not for lending.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-11" disabled={busy} onClick={confirm}>
              Confirm the loan
            </Button>
            <Button size="sm" variant="ghost" className="h-11" disabled={busy} onClick={() => setPicked(null)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Button size="sm" className="h-11" disabled={busy} onClick={accept}>
            Accept
          </Button>
          <details className="min-w-0 flex-1">
            <summary className="flex h-11 cursor-pointer items-center rounded-md text-sm text-muted-foreground hover:text-foreground">Decline</summary>
            <form action={decline} className="flex flex-col gap-2 pt-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Why not? Optional; they see this.
                <textarea
                  name="note"
                  maxLength={300}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <Button type="submit" variant="secondary" size="sm" className="h-11 self-start" disabled={busy}>
                Decline request
              </Button>
            </form>
          </details>
        </div>
      )}
      {status && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}

/** The borrower's Cancel on /loans. */
export function CancelRequest({ request }: { request: number }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    const { data, error } = await createClient().rpc("cancel_borrow_request", { p_request: request });
    setBusy(false);
    if (error || data !== "ok") return setStatus(error ? `Not cancelled (${error.message}).` : "They answered it meanwhile.");
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 pl-11">
      <Button size="sm" variant="secondary" className="h-11" disabled={busy} onClick={cancel}>
        Cancel request
      </Button>
      {status && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
