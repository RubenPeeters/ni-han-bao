"use client";

import { PageHeader } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// Deliberately ignores `error`: its message and stack must never reach a public page.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <section className="flex flex-col items-start gap-6">
      <PageHeader title="Something went wrong" description="This page failed to load. It is probably temporary." />
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </section>
  );
}
