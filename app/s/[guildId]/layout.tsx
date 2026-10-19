import { ServerBar } from "@/components/server-picker";
import { ServerNav } from "@/components/site-nav";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export default function ServerLayout({ children, params }: LayoutProps<"/s/[guildId]">) {
  return (
    <>
      {/* Pulled up against the header, as its second row. The guildId is known only at
          request time; the fallback has the row's height, so nothing jumps. */}
      <div className="-mt-6 min-h-8">
        <Suspense>{hasEnvVars ? <ServerBar params={params} /> : <ServerNav guild={null} guilds={[]} />}</Suspense>
      </div>
      {children}
    </>
  );
}
