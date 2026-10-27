import { PackOpener, type OpenablePrinting } from "@/components/pack-opener";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { PACK_LAYOUTS, PACK_SETS } from "@/bot/src/packs";
import { SET_NAMES } from "@/bot/src/card-match";
import { allPages } from "@/lib/decks";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "What a booster could contain: an unofficial simulation, nothing at stake.";

export const metadata = { title: "Open a pack · nexus", description: DESCRIPTION };

export default function PacksPage() {
  return (
    <>
      <PageHeader title="Open a pack" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <Packs />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
      <HowItIsBuilt />
    </>
  );
}

/** The packable sets' printings: the catalogue is for logged-in visitors only (RLS). */
async function Packs() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text="Log in to open a simulated Riftbound pack." />;
  const { data, error } = await allPages((from, to) =>
    supabase
      .from("riftbound_printings")
      .select("id, card_id, set_code, collector_code, collector_number, rarity, image_url, card:riftbound_cards(name, type)")
      .in("set_code", PACK_SETS)
      .order("id")
      .range(from, to)
      .returns<(Omit<OpenablePrinting, "name" | "type"> & { card: { name: string; type: string | null } | null })[]>(),
  );
  if (error) return <ErrorState title="Could not load the cards">Try again in a minute.</ErrorState>;
  const printings = data.map(({ card, ...p }) => ({ ...p, name: card?.name ?? p.card_id, type: card?.type ?? null }));
  return <PackOpener printings={printings} />;
}

/** Every slot of every offered set, with where its numbers come from. */
function HowItIsBuilt() {
  return (
    <section aria-labelledby="how" className="flex flex-col gap-3">
      <h2 id="how" className="text-lg font-semibold">
        How this pack is built
      </h2>
      <p className="text-sm text-muted-foreground">
        Only the basic printings of a set: no alternate arts, overnumbered, signed or showcase cards, since their rates are not published. A set is offered
        once its layout is known.
      </p>
      {PACK_SETS.map((set) => (
        <div key={set} className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{SET_NAMES[set] ?? set} pack layout</caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  {SET_NAMES[set] ?? set}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Cards
                </th>
                <th scope="col" className="p-3 font-medium">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {PACK_LAYOUTS[set].map((slot) => (
                <tr key={slot.label} className="border-t align-top">
                  <th scope="row" className="p-3 font-medium">
                    {slot.label}
                  </th>
                  <td className="p-3 text-right tabular-nums">{slot.count}</td>
                  <td className="p-3 text-muted-foreground">{slot.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
