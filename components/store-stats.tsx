import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";

interface Store {
  id: number;
  game: string;
  name: string;
  city: string;
  url: string | null;
  image_url: string | null;
}

/** A preview image (og:image, or a Discord event's cover) in its 1.91:1 shape, or the name's initial. */
export function StoreImage({ name, image_url }: { name: string; image_url: string | null }) {
  if (image_url) {
    return (
      // Hotlinked from the store's site or Discord, as for avatars and game icons: no next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image_url}
        alt=""
        width={54}
        height={28}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-7 w-[54px] shrink-0 rounded-md bg-muted object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-[54px] shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export async function StoreStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const [stores, regulars] = await Promise.all([
    supabase.from("stores").select("id, game, name, city, url, image_url").eq("guild_id", guild),
    // RLS leaves out members hidden in this server.
    supabase.rpc("store_regular_counts", { guild }),
  ]);
  if (stores.error || regulars.error) {
    return <ErrorState title="Could not load the stores">Try again in a minute.</ErrorState>;
  }
  const counts = new Map<number, number>(regulars.data.map((r: { store_id: number; regulars: number }) => [r.store_id, r.regulars]));
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
                <StoreImage {...store} />
                <span className="flex min-w-0 flex-1 flex-col">
                  {store.url ? (
                    <a
                      href={store.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="truncate underline-offset-4 hover:text-gold hover:underline"
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
