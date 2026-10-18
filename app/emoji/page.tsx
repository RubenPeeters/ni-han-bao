import { EmojiStats } from "@/components/emoji-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Emoji · ni han bao" };

export default function EmojiPage() {
  return (
    <>
      <PageHeader title="Emoji" description="What everyone reacts with." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <EmojiStats />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
