import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";

interface Store {
  id: number;
  game: string;
  name: string;
  city: string;
  url: string | null;
}

export async function StoreStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const [stores, regulars] = await Promise.all([
    supabase.from("stores").select("id, game, name, city, url").eq("guild_id", guild),
    // RLS leaves out members hidden in this server.
    // shortcut: PostgREST returns at most 1000 rows; count in the database if a server has more regulars.
    supabase.from("store_regulars").select("store_id").eq("guild_id", guild),
  ]);
  if (stores.error || regulars.error) {
    return <ErrorState title="Could not load the stores">Try again in a minute.</ErrorState>;
  }
  const counts = new Map<number, number>();
  for (const { store_id } of regulars.data) counts.set(store_id, (counts.get(store_id) ?? 0) + 1);
  const rows = (stores.data as Store[])
    .map((store) => ({ ...store, regulars: counts.get(store.id) ?? 0 }))
    .sort((a, b) => b.regulars - a.regulars || a.name.localeCompare(b.name));
  return (
    <StatGrid>
      <StatCard title="Stores" description="Members who call it a regular; mark yours with /store mine" wide>
        {rows.length === 0 ? (
          <EmptyState>No stores yet. Add the ones you play at with /store add in Discord.</EmptyState>
        ) : (
          <RankList>
            {rows.map((store, i) => (
              <RankRow key={store.id} rank={i + 1} value={store.regulars.toLocaleString("en-US")}>
                <span className="flex min-w-0 flex-1 flex-col">
                  {store.url ? (
                    <a
                      href={store.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="truncate underline-offset-4 hover:text-primary hover:underline"
                    >
                      {store.name}
                    </a>
                  ) : (
                    <span className="truncate">{store.name}</span>
                  )}
                  <span className="truncate text-xs text-muted-foreground">
                    {store.game === "Riftbound" ? store.city : `${store.city} · ${store.game}`}
                  </span>
                </span>
              </RankRow>
            ))}
          </RankList>
        )}
      </StatCard>
    </StatGrid>
  );
}
