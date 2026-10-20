"use client";

import { codeKey, normal, resolveCard, type Card, type Catalogue } from "@/bot/src/card-match";
import { missingCards, type OwnedCopy } from "@/bot/src/deck-match";
import { EmptyState, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LANGUAGES, languageName } from "@/lib/collection";
import { formatExact } from "@/lib/time";
import {
  addCard,
  championOf,
  changeEntry,
  deckText,
  deckWarnings,
  parseDeckList,
  replaceEntry,
  SECTIONS,
  VISIBILITIES,
  type DeckCards,
  type Entry,
  type PastedLine,
  type Section,
  withoutLine,
} from "@/lib/decks";
import { createClient } from "@/lib/supabase/client";
import { WISHLIST_MODES } from "@/lib/wishlist";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export interface Deck {
  id: string;
  name: string;
  legend_id: string | null;
  champion_id: string | null;
  notes: string;
  visibility: string;
  language: string;
  allow_other_languages: boolean;
  wishlist_mode: string;
}

/** A saved version, as History lists it. */
export interface VersionListed {
  version: number;
  saved_at: string;
}

/** A pasted line that is not exactly one card: kept for fixing, never guessed. */
interface Problem {
  line: PastedLine;
  ambiguous: Card[] | null;
}

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SEARCH_RESULTS = 8;
const legendLabel = (c: Card) => `${c.tags.join(", ")}, ${c.name}`;

/** The deck page: everything changes here first and is saved with Save, as one whole deck. */
export function DeckEditor({
  deck,
  entries,
  catalogue,
  owned,
  mine,
  versions,
  lending,
  children,
}: {
  deck: Deck;
  entries: Entry[];
  catalogue: Catalogue;
  /** The visitor's copies, for Missing cards (of their own collection, whoever owns the deck). */
  owned: OwnedCopy[];
  mine: boolean;
  /** Newest first, for History; null if they could not be loaded, absent to show no History. */
  versions?: VersionListed[] | null;
  /** Under Missing cards: who lends them, and the owner's Lending card (rendered on the server, of the deck as saved). */
  lending?: ReactNode;
  /** Under the heading: what a version page says about the version shown. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(deck);
  const [list, setList] = useState(entries);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [pasted, setPasted] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [copied, setCopied] = useState("");
  const cards = useMemo(() => new Map(catalogue.cards.map((c) => [c.id, c])), [catalogue]);
  const printings = useMemo(() => Map.groupBy(catalogue.printings, (p) => p.card_id), [catalogue]);
  const legends = useMemo(() => catalogue.cards.filter((c) => c.type === "Legend").toSorted((a, b) => legendLabel(a).localeCompare(legendLabel(b))), [catalogue]);
  const legend = settings.legend_id ? cards.get(settings.legend_id) : undefined;
  const champions = catalogue.cards.filter((c) => c.supertypes.includes("Champion") && (!legend || championOf(legend, c)));
  const warnings = deckWarnings(settings, list, cards);
  const missing = missingCards(settings, list, owned);
  const codes = useMemo(() => new Map(catalogue.printings.map((p) => [p.id, p.collector_code])), [catalogue]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const stay = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [dirty]);

  const change = (patch: Partial<Deck>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };
  const apply = (next: DeckCards) => {
    setSettings((s) => ({ ...s, legend_id: next.legend_id, champion_id: next.champion_id }));
    setList(next.entries);
    setDirty(true);
  };
  const current: DeckCards = { legend_id: settings.legend_id, champion_id: settings.champion_id, entries: list };

  const q = normal(query);
  const code = codeKey(query);
  const found = q
    ? catalogue.cards
        .filter(
          (c) =>
            normal(c.name).includes(q) ||
            c.tags.some((t) => normal(t).includes(q)) ||
            (/\d/.test(code) && (printings.get(c.id) ?? []).some((p) => codeKey(p.collector_code).startsWith(code))),
        )
        .slice(0, SEARCH_RESULTS)
    : [];

  const paste = () => {
    let next = current;
    const left: Problem[] = [];
    for (const line of parseDeckList(pasted)) {
      const r = resolveCard(catalogue, line.typed);
      if (r && "card" in r) next = addCard(next, r.card, line.quantity, line.heading);
      else left.push({ line, ambiguous: r?.ambiguous ?? null });
    }
    apply(next);
    setProblems(left);
    // What is left to fix stays in the box, under its heading so it lands in the same place.
    setPasted(
      left
        .flatMap((p, i) =>
          p.line.heading && p.line.heading !== left[i - 1]?.line.heading ? [`${p.line.heading}:`, p.line.text] : [p.line.text],
        )
        .join("\n"),
    );
  };

  const save = async () => {
    setStatus("Saving…");
    const { error } = await createClient().rpc("save_riftbound_deck", {
      p_deck: settings.id,
      p_name: settings.name.trim() || "Untitled deck",
      p_legend: settings.legend_id,
      p_champion: settings.champion_id,
      p_notes: settings.notes,
      p_visibility: settings.visibility,
      p_language: settings.language,
      p_allow_other_languages: settings.allow_other_languages,
      p_entries: list,
      p_wishlist_mode: settings.wishlist_mode,
    });
    if (error) return setStatus(`Not saved (${error.message}). Try again.`);
    setDirty(false);
    setStatus("Saved");
    router.refresh();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(deckText(current, cards));
      setCopied("Copied: paste it into any deck's Or paste a list.");
    } catch {
      setCopied("Could not copy: your browser blocked it.");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${settings.name}? This cannot be undone.`)) return;
    const { error } = await createClient().rpc("delete_riftbound_deck", { p_deck: settings.id });
    if (error) return setStatus(`Not deleted (${error.message}). Try again.`);
    setDirty(false);
    router.push("/decks");
  };

  const champion = settings.champion_id ? cards.get(settings.champion_id) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/decks" className="w-fit rounded-md text-sm text-muted-foreground hover:text-foreground">
          {mine ? "Your decks" : "Decks"}
        </Link>
        <h1 className="break-words text-4xl font-semibold">{settings.name || "Untitled deck"}</h1>
        <p className="text-muted-foreground">
          {[legend ? legendLabel(legend) : "No Legend yet", champion && `Chosen Champion: ${champion.name}`, languageName(settings.language)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" className="h-11" onClick={copy}>
            Copy as text
          </Button>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {copied}
          </p>
        </div>
      </div>

      {children}

      <StatCard
        title="Rules check"
        description="Warnings only: a deck is saved whatever they say"
      >
        {warnings.length === 0 ? (
          <p className="text-sm">No rule with a source is broken.</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </StatCard>

      <StatCard
        title="Missing cards"
        description={`${missing.missing ? `${missing.missing} missing` : "Nothing missing"} against your collection${settings.allow_other_languages ? "" : `, ${languageName(settings.language)} copies only`}`}
      >
        {missing.rows.length === 0 ? (
          <EmptyState>No cards yet.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {missing.rows.map((r) => (
              <li key={`${r.section}|${r.card_id}|${r.printing_id}`} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{cards.get(r.card_id)?.name ?? r.card_id}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      r.section === "legend" ? "Legend" : SECTIONS.find((x) => x.value === r.section)?.label,
                      r.printing_id && codes.get(r.printing_id),
                      `you own ${r.owned} of ${r.quantity}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums ${r.owned < r.quantity ? "font-medium" : "text-muted-foreground"}`}>
                  {r.owned < r.quantity ? `${r.quantity - r.owned} missing` : "Complete"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StatCard>

      {lending}

      {mine && (
        <StatCard title="Add cards" description="Search by name, champion or collector code">
          <Input
            type="search"
            aria-label="Search cards to add"
            placeholder="Search to add"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && found.length === 1) apply(addCard(current, found[0], 1));
            }}
            className="h-11 text-base md:text-base"
          />
          {q && found.length === 0 && <EmptyState>No card matches.</EmptyState>}
          {found.length > 0 && (
            <ul className="flex flex-col divide-y">
              {found.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{c.type === "Legend" ? legendLabel(c) : c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{[c.type, ...c.domains].join(" · ")}</span>
                  </span>
                  <Button variant="secondary" size="icon" className="size-11 shrink-0" aria-label={`Add ${c.name}`} onClick={() => apply(addCard(current, c, 1))}>
                    <Plus aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="deck-paste">Or paste a list</Label>
            <textarea
              id="deck-paste"
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"3 Card Name\n2 OGN-001\nSideboard:\n1 Card Name"}
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button variant="secondary" className="h-11 self-start" disabled={!pasted.trim()} onClick={paste}>
              Add the list
            </Button>
          </div>
          {problems.length > 0 && (
            <div className="flex flex-col gap-2" role="status">
              <p className="text-sm font-medium">
                {problems.length === 1 ? "1 line was not added" : `${problems.length} lines were not added`}: fix them in the box, or pick the card.
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {problems.map((p, i) => (
                  <li key={`${i}-${p.line.text}`} className="flex flex-col gap-1">
                    <span className="break-words">
                      <span className="font-medium">{p.line.text}</span>
                      <span className="text-muted-foreground">{p.ambiguous ? ": more than one card matches" : ": no card called or numbered that"}</span>
                    </span>
                    {p.ambiguous && (
                      <span className="flex flex-wrap gap-2">
                        {p.ambiguous.slice(0, 6).map((c) => (
                          <Button
                            key={c.id}
                            variant="secondary"
                            size="sm"
                            className="h-11"
                            onClick={() => {
                              apply(addCard(current, c, p.line.quantity, p.line.heading));
                              setProblems(problems.filter((x) => x !== p));
                              setPasted((text) => withoutLine(text, p.line.text));
                            }}
                          >
                            {c.type === "Legend" ? legendLabel(c) : c.name}
                          </Button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </StatCard>
      )}

      {SECTIONS.map(({ value, label }) => {
        const rows = list.filter((e) => e.section === value);
        const count = rows.reduce((n, e) => n + e.quantity, 0);
        if (!mine && rows.length === 0) return null;
        return (
          <StatCard key={value} title={label} description={`${count} ${count === 1 ? "card" : "cards"}`}>
            {rows.length === 0 ? (
              <EmptyState>Nothing here yet.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y">
                {rows
                  .toSorted((a, b) => (cards.get(a.card_id)?.name ?? "").localeCompare(cards.get(b.card_id)?.name ?? ""))
                  .map((e) => (
                    <EntryRow
                      key={`${e.card_id}|${e.printing_id}`}
                      entry={e}
                      card={cards.get(e.card_id)}
                      printings={printings.get(e.card_id) ?? []}
                      mine={mine}
                      onChange={(next) => {
                        setList(next(list));
                        setDirty(true);
                      }}
                    />
                  ))}
              </ul>
            )}
          </StatCard>
        );
      })}

      {!mine && settings.notes && (
        <StatCard title="Notes" description="From the deck's owner">
          <p className="whitespace-pre-line break-words text-sm">{settings.notes}</p>
        </StatCard>
      )}

      {versions !== undefined && (
        <StatCard title="History" description="Every save is a version: view one, compare it or restore it">
          {versions === null ? (
            <EmptyState>Could not load the history. Try again in a minute.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y">
              {versions.map((v, i) => (
                <li key={v.version}>
                  <Link
                    href={`/decks/${deck.id}/versions/${v.version}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-md py-2 text-sm hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">Version {v.version}</span>
                    <span className="truncate text-xs text-muted-foreground">{[i === 0 && "Current", formatExact(new Date(v.saved_at))].filter(Boolean).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </StatCard>
      )}

      {mine && (
        <StatCard title="Deck" description="Name, Legend, who sees it, its language and wishlist">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Name
              <Input value={settings.name} maxLength={100} onChange={(e) => change({ name: e.target.value })} className="h-11 text-base md:text-base" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Legend
              <select value={settings.legend_id ?? ""} onChange={(e) => change({ legend_id: e.target.value || null })} className={field}>
                <option value="">No Legend yet</option>
                {legends.map((c) => (
                  <option key={c.id} value={c.id}>
                    {legendLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Chosen Champion
              <select
                value={settings.champion_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  // The Chosen Champion is one of the main deck's cards: put one in if it is not there.
                  const missing = id && !list.some((x) => x.section === "main" && x.card_id === id);
                  if (missing) setList(changeEntry(list, { section: "main", card_id: id, printing_id: null }, 1));
                  change({ champion_id: id });
                }}
                className={field}
              >
                <option value="">None yet</option>
                {/* A champion picked before the Legend changed stays listed, so the select shows it. */}
                {champion && !champions.includes(champion) && <option value={champion.id}>{champion.name}</option>}
                {champions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Who sees it
              <select value={settings.visibility} onChange={(e) => change({ visibility: e.target.value })} className={field}>
                {VISIBILITIES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Language
              <select value={settings.language} onChange={(e) => change({ language: e.target.value })} className={field}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-h-11 items-center gap-3 sm:mt-7">
              <Checkbox
                id="deck-other-languages"
                checked={settings.allow_other_languages}
                onCheckedChange={(v) => change({ allow_other_languages: v === true })}
              />
              <Label htmlFor="deck-other-languages">Copies in other languages count</Label>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Wishlist
              <select value={settings.wishlist_mode} onChange={(e) => change({ wishlist_mode: e.target.value })} className={field}>
                {WISHLIST_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted-foreground">
                {WISHLIST_MODES.find((m) => m.value === settings.wishlist_mode)?.hint}
              </span>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
              Notes
              <textarea
                value={settings.notes}
                maxLength={2000}
                rows={3}
                onChange={(e) => change({ notes: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
          </div>
          <Button variant="destructive" size="sm" className="h-11 self-start" onClick={remove}>
            Delete deck
          </Button>
        </StatCard>
      )}

      {mine && (
        // In reach of a thumb wherever the page is scrolled to.
        <div className="sticky bottom-0 z-10 -mx-5 flex items-center justify-between gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur">
          <p aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
            {status || (dirty ? "Unsaved changes" : "All changes saved")}
          </p>
          <Button className="h-11 shrink-0" disabled={!dirty} onClick={save}>
            Save deck
          </Button>
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  card,
  printings,
  mine,
  onChange,
}: {
  entry: Entry;
  card: Card | undefined;
  printings: Catalogue["printings"];
  mine: boolean;
  onChange: (update: (list: Entry[]) => Entry[]) => void;
}) {
  const name = card?.name ?? entry.card_id;
  const pinned = printings.find((p) => p.id === entry.printing_id);
  return (
    <li className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Link href={`/cards/${entry.card_id}`} className="flex min-w-0 flex-1 flex-col rounded-md hover:underline">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {[card?.type, ...(card?.domains ?? []), pinned ? `Only ${pinned.collector_code}` : null].filter(Boolean).join(" · ")}
          </span>
        </Link>
        {mine ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button variant="secondary" size="icon" className="size-11" aria-label={`One fewer: ${name}`} onClick={() => onChange((l) => changeEntry(l, entry, -1))}>
              <Minus aria-hidden />
            </Button>
            <span className="w-7 text-center text-lg font-semibold tabular-nums">{entry.quantity}</span>
            <Button variant="secondary" size="icon" className="size-11" aria-label={`One more: ${name}`} onClick={() => onChange((l) => changeEntry(l, entry, 1))}>
              <Plus aria-hidden />
            </Button>
          </span>
        ) : (
          <span className="shrink-0 font-semibold tabular-nums">{entry.quantity}×</span>
        )}
      </div>
      {mine && (
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label={`Section of ${name}`}
            value={entry.section}
            onChange={(e) => onChange((l) => replaceEntry(l, entry, { ...entry, section: e.target.value as Section }))}
            className={field}
          >
            {SECTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`Printing of ${name}`}
            value={entry.printing_id ?? ""}
            onChange={(e) => onChange((l) => replaceEntry(l, entry, { ...entry, printing_id: e.target.value || null }))}
            className={field}
          >
            <option value="">Any printing</option>
            {printings.map((p) => (
              <option key={p.id} value={p.id}>
                Only {p.collector_code}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}

/** Restore on a version page: the version saved again as the deck's newest, under the deck's current visibility. */
export function RestoreVersion({ deck, entries, version }: { deck: Deck; entries: Entry[]; version: number }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const restore = async () => {
    setStatus("Restoring…");
    const { error } = await createClient().rpc("save_riftbound_deck", {
      p_deck: deck.id,
      p_name: deck.name,
      p_legend: deck.legend_id,
      p_champion: deck.champion_id,
      p_notes: deck.notes,
      p_visibility: deck.visibility,
      p_language: deck.language,
      p_allow_other_languages: deck.allow_other_languages,
      p_entries: entries,
    });
    if (error) return setStatus(`Not restored (${error.message}). Try again.`);
    router.push(`/decks/${deck.id}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button className="h-11" onClick={restore} disabled={status === "Restoring…"}>
        Restore version {version}
      </Button>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status || "Saves it as a new version; nothing is lost."}
      </p>
    </div>
  );
}
