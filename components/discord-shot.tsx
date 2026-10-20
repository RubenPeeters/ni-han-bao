import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImageIcon } from "lucide-react";

/**
 * A screenshot of Discord's own screens, taken by hand (issue 164) into public/docs/discord/.
 * Until that file is committed, a placeholder box instead of a broken image.
 */
export function DiscordShot({ name, alt }: { name: string; alt: string }) {
  const src = `/docs/discord/${name}.png`;
  // The docs pages are prerendered at build, where public/ is on disk.
  if (existsSync(join(process.cwd(), "public", src))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" className="rounded-xl border" />;
  }
  return (
    <figure className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      <ImageIcon aria-hidden className="size-6" />
      <figcaption>Screenshot coming: {alt}</figcaption>
    </figure>
  );
}
