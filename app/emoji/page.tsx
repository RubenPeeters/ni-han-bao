import { EmojiStats } from "@/components/emoji-stats";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Emoji · ni han bao" };

export default function EmojiPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold">Emoji</h1>
        <p className="text-muted-foreground">What everyone reacts with.</p>
      </div>
      {hasEnvVars ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <EmojiStats />
        </Suspense>
      ) : (
        <p className="text-sm">Supabase env vars are not set.</p>
      )}
    </>
  );
}
