import { EmptyState, ErrorState, StatCard, StatGrid } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

interface Printing {
  collector_code: string;
  image_url: string | null;
  card: { id: string; name: string; type: string; energy: number | null; might: number | null; placeholder: boolean };
}

const TYPES = ["Legend", "Unit", "Spell", "Gear"];
// shortcut: the first few of each type, no search or paging; add them with the first page that needs a card list.
const PER_TYPE = 8;
// shortcut: PostgREST caps a response at 1000 rows, so past that the counts undercount; query per type when the real API (#96) lands.
const MAX_PRINTINGS = 1000;

/** The global Riftbound catalogue: not per server, so no guild filter. */
export async function CardCatalogue() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("riftbound_printings")
    .select("collector_code, image_url, card:riftbound_cards!inner(id, name, type, energy, might, placeholder)")
    .order("collector_number")
    .order("collector_code")
    .limit(MAX_PRINTINGS);
  if (error) return <ErrorState title="Could not load the cards">Try again in a minute.</ErrorState>;
  const printings = data as unknown as Printing[];
  if (printings.length === 0) return <EmptyState>No cards yet.</EmptyState>;
  const types = [...TYPES, ...new Set(printings.map((p) => p.card.type).filter((t) => !TYPES.includes(t)))];
  return (
    <StatGrid>
      {types.map((type) => {
        const all = printings.filter((p) => p.card.type === type);
        if (all.length === 0) return null;
        return (
          <StatCard
            key={type}
            title={type === "Gear" ? type : `${type}s`}
            description={`${all.length.toLocaleString("en-US")} in the catalogue${all.length > PER_TYPE ? `, the first ${PER_TYPE} shown` : ""}`}
            wide
          >
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {all.slice(0, PER_TYPE).map((p) => (
                <CardTile key={p.collector_code} printing={p} />
              ))}
            </ul>
          </StatCard>
        );
      })}
    </StatGrid>
  );
}

function CardTile({ printing: { collector_code, image_url, card } }: { printing: Printing }) {
  const stats = [card.energy !== null && `${card.energy} energy`, card.might !== null && `${card.might} might`].filter(Boolean);
  return (
    <li className="flex min-w-0 flex-col gap-2">
      {image_url ? (
        // Data Dragon art is referenced, never rehosted (Riot's terms), and next/image would copy it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image_url}
          alt=""
          width={308}
          height={560}
          className="aspect-[308/560] w-full rounded-lg bg-muted object-cover"
        />
      ) : (
        <div aria-hidden className="aspect-[308/560] w-full rounded-lg bg-muted" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-sm font-medium" title={card.name}>
          {card.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{[collector_code, ...stats].join(" · ")}</p>
        {/* Made up until Riot approves the API key: nobody may mistake it for a real card. */}
        {card.placeholder && (
          <Badge variant="secondary" className="w-fit">
            Placeholder card
          </Badge>
        )}
      </div>
    </li>
  );
}
