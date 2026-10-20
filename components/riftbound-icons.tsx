// Riot's official Riftbound icons, from the card feed's riftbound_icons rows: referenced
// on Riot's CDN, never rehosted or redrawn. A value without an official icon shows its name.
import { cardImageUrl, plainText, textParts, type CardToken } from "@/bot/src/card-match";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RiftboundIcon {
  facet: string;
  value: string;
  label: string;
  icon_url: string;
}

// Riot draws these white: dark on the light theme.
const WHITE = new Set(["type", "supertype"]);

const find = (icons: RiftboundIcon[], facet: string, match: (i: RiftboundIcon) => boolean) =>
  icons.find((i) => i.facet === facet && match(i));

/** The icon alone, named "Fury"; `withText` shows the name next to it, the icon then decorative. */
export function FacetIcon({ icons, facet, name, withText }: { icons: RiftboundIcon[]; facet: string; name: string; withText?: boolean }) {
  const icon = find(icons, facet, (i) => i.label === name);
  if (!icon) return withText ? <span>{name}</span> : <TextBadge label={name} />;
  const img = <OfficialImg url={icon.icon_url} white={WHITE.has(facet)} label={withText ? "" : name} />;
  return withText ? (
    <span className="inline-flex items-center gap-1" title={name}>
      {img}
      {name}
    </span>
  ) : (
    img
  );
}

function OfficialImg({ url, white, label }: { url: string; white: boolean; label: string }) {
  return (
    // Riot's icons are referenced, never rehosted (Riot's terms), and next/image would copy them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageUrl(url, 64)}
      alt={label}
      title={label || undefined}
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      className={cn("inline-block size-4 shrink-0 object-contain align-[-0.2em]", white && "invert dark:invert-0")}
    />
  );
}

type IconProps = { icons: RiftboundIcon[]; withText?: boolean };
export const DomainIcon = ({ domain, ...p }: IconProps & { domain: string }) => <FacetIcon facet="domain" name={domain} {...p} />;
export const TypeIcon = ({ type, ...p }: IconProps & { type: string }) => <FacetIcon facet="type" name={type} {...p} />;
export const SupertypeIcon = ({ supertype, ...p }: IconProps & { supertype: string }) => (
  <FacetIcon facet="supertype" name={supertype} {...p} />
);
export const RarityIcon = ({ rarity, ...p }: IconProps & { rarity: string }) => <FacetIcon facet="rarity" name={rarity} {...p} />;

/** A cost in energy: the number in a round badge. */
export function EnergyBadge({ value }: { value: number | string }) {
  return (
    <span
      role="img"
      aria-label={`${value} energy`}
      title={`${value} energy`}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground align-[-0.3em] text-xs font-semibold tabular-nums text-background"
    >
      {value}
    </span>
  );
}

/** A token without an official icon (":rb_exhaust:"), as its name. */
function TextBadge({ label }: { label: string }) {
  return <span className="mx-0.5 inline-block rounded border px-1 text-xs font-medium leading-tight text-foreground">{label}</span>;
}

/** One of Riot's white glyphs (might), in the text's colour: their CDN allows the mask's CORS fetch. */
function Glyph({ url }: { url: string }) {
  const mask = `url("${url}") center / contain no-repeat`;
  return <span aria-hidden className="inline-block size-4 bg-current align-[-0.2em]" style={{ mask, WebkitMask: mask }} />;
}

/** A decorative icon with its words as hidden text: copied rules text keeps "Might", which alt text would not. */
function Worded({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label}>
      {children}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Token({ token, icons }: { token: CardToken; icons: RiftboundIcon[] }) {
  if (token.kind === "energy") return <EnergyBadge value={token.value} />;
  if (token.kind === "might") {
    const might = find(icons, "glyph", (i) => i.value === "might");
    if (might)
      return (
        <Worded label={token.label}>
          <Glyph url={might.icon_url} />
        </Worded>
      );
  }
  if (token.kind === "rune") {
    const domain = find(icons, "domain", (i) => i.value === token.value);
    if (domain)
      return (
        <Worded label={token.label}>
          <OfficialImg url={domain.icon_url} white={false} label="" />
        </Worded>
      );
  }
  return <TextBadge label={token.label} />;
}

/** Riot's card text with its icon tokens drawn; the stored text stays as Riot gives it. */
export function RulesText({ html, icons, className }: { html: string; icons: RiftboundIcon[]; className?: string }) {
  return (
    <p className={cn("whitespace-pre-line", className)}>
      {textParts(plainText(html)).map((part, i) => (typeof part === "string" ? part : <Token key={i} token={part} icons={icons} />))}
    </p>
  );
}
