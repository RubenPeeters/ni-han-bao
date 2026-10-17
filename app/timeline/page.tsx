import { ThemeSwitcher } from "@/components/theme-switcher";
import { Timeline } from "@/components/timeline";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export const metadata = { title: "Timeline · ni han bao" };

export default function TimelinePage() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full max-w-3xl flex flex-col gap-10 p-5">
        <header className="flex justify-between items-center border-b border-b-foreground/10 py-4">
          <h1 className="text-2xl font-bold">
            <Link href="/">ni han bao</Link> · timeline
          </h1>
          <ThemeSwitcher />
        </header>
        {hasEnvVars ? (
          <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
            <Timeline />
          </Suspense>
        ) : (
          <p className="text-sm">Supabase env vars are not set.</p>
        )}
      </div>
    </main>
  );
}
