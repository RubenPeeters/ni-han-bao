"use client";

import { SET_NAMES } from "@/bot/src/card-match";
import { openPack, PACK_DISCLAIMER, PACK_SETS, type PackCard, type PackPrinting } from "@/bot/src/packs";
import { CardThumb } from "@/components/card-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface OpenablePrinting extends PackPrinting {
  card_id: string;
  name: string;
  image_url: string | null;
}

/** A card of the pack with its slot, and a Foil badge for the foil slot. */
function PackTile({ card, eager, width }: { card: PackCard<OpenablePrinting>; eager?: boolean; width: number }) {
  const { printing, slot, foil } = card;
  return (
    <figure className="flex flex-col gap-1.5">
      <div className={foil ? "rounded-lg ring-2 ring-crystal ring-offset-2 ring-offset-background" : undefined}>
        <CardThumb url={printing.image_url} name={printing.name} landscape={printing.type === "Battlefield"} width={width} eager={eager} />
      </div>
      <figcaption className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium">{printing.name}</span>
        {foil && <Badge variant="secondary">Foil</Badge>}
        <span className="w-full text-xs text-muted-foreground">
          {slot} · {printing.rarity ?? "-"}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Open a pack (issue 308): the cards one by one, then the whole pack. Opened in the browser and kept
 * nowhere: no table, no collection, nothing to spend or earn.
 */
export function PackOpener({ printings }: { printings: OpenablePrinting[] }) {
  const [set, setSet] = useState(PACK_SETS[0]);
  const [pack, setPack] = useState<PackCard<OpenablePrinting>[] | null>(null);
  const [shown, setShown] = useState(0);
  const open = () => {
    setPack(openPack(set, printings, Math.random));
    setShown(1);
  };
  const done = pack !== null && shown >= pack.length;
  const current = pack && !done ? pack[shown - 1] : null;
  return (
    <section aria-label="Your pack" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {PACK_SETS.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            Set
            <select value={set} onChange={(e) => setSet(e.target.value)} className="h-10 rounded-md border bg-background px-2">
              {PACK_SETS.map((s) => (
                <option key={s} value={s}>
                  {SET_NAMES[s] ?? s}
                </option>
              ))}
            </select>
          </label>
        )}
        {(pack === null || done) && (
          <Button size="lg" onClick={open}>
            {pack === null ? "Open a pack" : "Open another"}
          </Button>
        )}
        {current && (
          <>
            <Button size="lg" onClick={() => setShown(shown + 1)}>
              Next card
            </Button>
            <Button size="lg" variant="outline" onClick={() => setShown(pack!.length)}>
              Show all
            </Button>
          </>
        )}
      </div>
      {pack !== null && (
        <>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {current ? `Card ${shown} of ${pack.length}` : `All ${pack.length} cards`}
          </p>
          {current ? (
            <div className="w-full max-w-60">
              <PackTile key={shown} card={current} width={240} eager />
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              {pack.map((card, i) => (
                <li key={i}>
                  <PackTile card={card} width={160} eager />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{PACK_DISCLAIMER}</p>
        </>
      )}
    </section>
  );
}
