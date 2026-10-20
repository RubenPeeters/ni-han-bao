import { cardImageUrl } from "@/bot/src/card-match";
import { cn } from "@/lib/utils";

/**
 * A card's image at `width` CSS pixels from Riot's CDN, in a frame reserved before it loads.
 * Battlefields are printed landscape (`landscape`); `art` crops a portrait card to its art.
 * Without an image, a frame with the name.
 */
export function CardThumb({
  url,
  name,
  landscape = false,
  width = 320,
  eager,
  art = false,
}: {
  url: string | null;
  name: string;
  landscape?: boolean;
  width?: number;
  eager?: boolean;
  art?: boolean;
}) {
  const frame = cn("w-full rounded-lg bg-muted", art ? "aspect-[4/3]" : landscape ? "aspect-[1039/744]" : "aspect-[744/1039]");
  return url ? (
    // Riot's card art is referenced, never rehosted (Riot's terms), and next/image would copy it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageUrl(url, width)}
      srcSet={`${cardImageUrl(url, width)} 1x, ${cardImageUrl(url, width * 2)} 2x`}
      // The name is always next to it.
      alt=""
      width={landscape ? 1039 : 744}
      height={landscape ? 744 : 1039}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      // The art fills a card's upper half, under its name and cost.
      className={cn(frame, art ? "object-cover object-[50%_20%]" : "object-contain")}
    />
  ) : (
    <div aria-hidden className={cn(frame, "flex items-center justify-center border p-2 text-center text-xs text-muted-foreground")}>
      {name}
    </div>
  );
}
