import { loadStatus } from "@/components/bot-status";
import { ErrorState } from "@/components/stat-ui";
import type { ReactNode } from "react";

const fmt = (n: number) => n.toLocaleString("en-US");

// Totals across every server: logged-out visitors see nothing per server or per person.
export async function HomeStats() {
  const { data, error } = await loadStatus();

  if (error) {
    return <ErrorState title="Could not load the stats">Try again in a minute.</ErrorState>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <HomeStat label="Servers">{fmt(data.servers)}</HomeStat>
      <HomeStat label="Members">{fmt(data.members)}</HomeStat>
      <HomeStat label="Messages this week">{fmt(data.messages_since)}</HomeStat>
      <HomeStat label="Active members this week">{fmt(data.active_since)}</HomeStat>
    </div>
  );
}

function HomeStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card flex min-w-0 flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-h-8 text-2xl font-semibold tabular-nums">{children}</span>
    </div>
  );
}

/** Suspense fallback shaped like the cards, so content does not jump when it streams in. */
export function HomeStatsSkeleton() {
  return (
    <div role="status" aria-busy className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} aria-hidden className="card flex animate-pulse flex-col gap-2">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-8 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
