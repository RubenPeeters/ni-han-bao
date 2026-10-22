// A deck as cards: shared by the deck page, the public deck page and a version page.
// Card data only, never win, play or popularity rates (Riot's policy).
import type { Card, Printing } from "@/bot/src/card-match";
import { CardThumb } from "@/components/card-thumb";
import { TypeIcon, type RiftboundIcon } from "@/components/riftbound-icons";
import { byType, energyCurve, SECTIONS, type Entry } from "@/lib/decks";
import Link from "next/link";

export type CardImage = (card_id: string, printing_id: string | null) => string | null;

/** A card's image: its pinned printing's, else its first printing's with one (`printings` in collector order). */
export function cardImage(printings: Printing[]): CardImage {
  const byId = new Map(printings.map((p) => [p.id, p.image_url]));
  const first = new Map<string, string>();
  for (const p of printings) if (p.image_url && !first.has(p.card_id)) first.set(p.card_id, p.image_url);
  return (card_id, printing_id) => (printing_id && byId.get(printing_id)) || first.get(card_id) || null;
}

const focus = "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The Legend or the Chosen Champion in a deck's header, an empty frame without one. */
export function CardFigure({
  label,
  card,
  printing = null,
  image,
}: {
  label: string;
  card: Card | undefined;
  /** The pinned printing to show, if any. */
  printing?: string | null;
  image: CardImage;
}) {
  return (
    <figure className="flex w-24 shrink-0 flex-col gap-1 sm:w-32">
      {card ? (
        <Link href={`/cards/${card.id}`} aria-label={`${label}: ${card.name}`} className={focus}>
          <CardThumb url={image(card.id, printing)} name={card.name} width={256} eager />
        </Link>
      ) : (
        <CardThumb url={null} name={`No ${label} yet`} />
      )}
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** The main deck's copies per energy cost, as columns with their counts written on them. */
export function EnergyCurve({ entries, cards }: { entries: Entry[]; cards: Map<string, Card> }) {
  const curve = energyCurve(entries, cards);
  const top = Math.max(1, ...curve.map((c) => c.count));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold">
        Energy curve <span className="text-xs font-normal text-muted-foreground">main deck copies per energy cost</span>
      </figcaption>
      <ol className="flex max-w-md gap-1.5">
        {curve.map((c) => (
          <li key={c.energy} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">
              {c.count}
              <span className="sr-only"> at {c.energy} energy</span>
            </span>
            <span aria-hidden className="flex h-16 w-full items-end">
              <span className="w-full rounded-t bg-chart-2" style={{ height: `${(c.count / top) * 100}%` }} />
            </span>
            <span aria-hidden className="text-xs font-medium tabular-nums">
              {c.energy}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Each section as card images with a count badge; the main deck by type, each type by energy. */
export function VisualDecklist({
  entries,
  cards,
  image,
  icons,
}: {
  entries: Entry[];
  cards: Map<string, Card>;
  image: CardImage;
  icons: RiftboundIcon[];
}) {
  const count = (es: Entry[]) => es.reduce((n, e) => n + e.quantity, 0);
  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map(({ value, label }) => {
        const rows = entries.filter((e) => e.section === value);
        if (rows.length === 0) return null;
        const groups = value === "main" ? byType(rows, cards) : [{ type: null, entries: byType(rows, cards).flatMap((g) => g.entries) }];
        const landscape = value === "battlefields";
        return (
          <section key={value} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {label} <span className="font-normal tabular-nums text-muted-foreground">· {count(rows)}</span>
            </h3>
            {groups.map((g) => (
              <div key={g.type ?? value} className="flex flex-col gap-2">
                {g.type && (
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <TypeIcon icons={icons} type={g.type} withText />
                    <span className="tabular-nums">· {count(g.entries)}</span>
                  </h4>
                )}
                <ul className={landscape ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6"}>
                  {g.entries.map((e) => {
                    const name = cards.get(e.card_id)?.name ?? e.card_id;
                    return (
                      <li key={`${e.card_id}|${e.printing_id}`} className="min-w-0">
                        <Link href={`/cards/${e.card_id}`} className={`flex flex-col gap-1 ${focus} active:opacity-80`}>
                          <span className="relative">
                            <CardThumb url={image(e.card_id, e.printing_id)} name={name} landscape={landscape} width={landscape ? 320 : 200} />
                            <span
                              aria-hidden
                              className="absolute right-1 top-1 rounded-full bg-background/90 px-1.5 text-xs font-semibold tabular-nums shadow-sm"
                            >
                              ×{e.quantity}
                            </span>
                          </span>
                          <span className="truncate text-xs" title={name}>
                            <span className="sr-only">{e.quantity} × </span>
                            {name}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
