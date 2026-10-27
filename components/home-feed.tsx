import { RelativeTime } from "@/components/relative-time";
import { EmptyState, ErrorState, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { buildFeed, FILTERS, PAGE, type FeedItem, type FeedRow, type Filter } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const query = (filter: Filter, show: number) => {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (show > PAGE) params.set("show", String(show));
  const q = params.toString();
  return q ? `/?${q}` : "/";
};

/** The logged-in home: the visitor's own items, then what happened in their servers. */
export async function HomeFeed({ filter, show }: { filter: Filter; show: number }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("home_feed");
  if (error) {
    return <ErrorState title="Could not load your feed">Try again in a minute.</ErrorState>;
  }
  const { forYou, happening } = buildFeed(data as FeedRow[], filter);
  return (
    <div className="flex flex-col gap-6">
      {forYou.length > 0 && (
        <StatCard title="For you" description="Waiting on you.">
          <FeedList items={forYou} />
        </StatCard>
      )}
      <StatCard
        title="Happening"
        description="In your servers, newest first."
        aside={
          <nav aria-label="Show" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button key={f.value} asChild variant={f.value === filter ? "default" : "ghost"} size="sm" className="h-11">
                <Link href={query(f.value, PAGE)} scroll={false} aria-current={f.value === filter ? "page" : undefined}>
                  {f.label}
                </Link>
              </Button>
            ))}
          </nav>
        }
      >
        {happening.length === 0 ? (
          <EmptyState>Nothing here yet.</EmptyState>
        ) : (
          <FeedList items={happening.slice(0, show)} />
        )}
        {happening.length > show && (
          <Button asChild variant="outline" className="h-11 self-center">
            <Link href={query(filter, show + PAGE)} scroll={false}>
              Show more
            </Link>
          </Button>
        )}
      </StatCard>
    </div>
  );
}

function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <ul className="flex flex-col divide-y">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="flex min-h-11 flex-col gap-1 rounded-md py-3 text-sm hover:bg-secondary/50 active:bg-secondary"
          >
            <span className="font-medium">{item.text}</span>
            {item.detail && <span className="text-muted-foreground">{item.detail}</span>}
            <span className="text-xs text-muted-foreground">
              {item.guild && <>{item.guild.name} · </>}
              <RelativeTime date={new Date(item.at)} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
