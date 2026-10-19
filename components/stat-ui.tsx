import { cn } from "@/lib/utils";
import { CircleAlert, Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-4xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

/** The shared grid: half-width cards side by side from `sm`, `wide` cards span both columns. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 sm:grid-cols-2">{children}</div>;
}

export function StatCard({
  title,
  description,
  aside,
  wide,
  children,
}: {
  title: string;
  description: string;
  aside?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("card flex min-w-0 flex-col gap-4", wide && "sm:col-span-2")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RankList({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col divide-y">{children}</ol>;
}

export function RankRow({ rank, value, children }: { rank: number; value: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
      <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{rank}</span>
      {children}
      <span className="min-w-12 shrink-0 text-right font-medium tabular-nums">{value}</span>
    </li>
  );
}

/** One row for any member list; hidden members never reach here, the database filters them. */
export function MemberRankRow({
  rank,
  name,
  avatarUrl,
  value,
  href,
  detail,
}: {
  rank: number;
  name: string;
  avatarUrl: string | null;
  value: string;
  href?: string;
  /** A second, smaller line under the name. */
  detail?: ReactNode;
}) {
  return (
    <RankRow rank={rank} value={value}>
      {avatarUrl ? (
        // Discord CDN avatars are already small; next/image would need a remote
        // pattern and optimisation quota for no visible gain.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-full bg-muted object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        {href ? (
          <Link href={href} className="truncate underline-offset-4 hover:text-primary hover:underline">
            {name}
          </Link>
        ) : (
          <span className="truncate">{name}</span>
        )}
        {detail && <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{detail}</span>}
      </span>
    </RankRow>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      <Inbox className="size-5" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-5"
    >
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <ErrorState title="Stats are not connected">
      The Supabase environment variables are not set for this deployment.
    </ErrorState>
  );
}

/** Suspense fallback shaped like the page's cards, so content does not jump when it streams in. */
export function StatsSkeleton({ cards, wide }: { cards: number; wide?: boolean }) {
  return (
    <div role="status" aria-busy className="grid gap-6 sm:grid-cols-2">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={cn("card flex animate-pulse flex-col gap-4", wide && "sm:col-span-2")}
        >
          <div className="flex flex-col gap-2">
            <div className="h-5 w-32 rounded bg-muted" />
            <div className="h-3 w-48 max-w-full rounded bg-muted" />
          </div>
          {Array.from({ length: 5 }, (_, j) => (
            <div key={j} className="flex items-center gap-3">
              <div className="size-7 shrink-0 rounded-full bg-muted" />
              <div className="h-3 flex-1 rounded bg-muted" />
              <div className="h-3 w-10 rounded bg-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
