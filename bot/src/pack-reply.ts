// /pack open (#308): an unofficial booster simulation in the shared reply layout. Nothing is stored.
import { ApplicationCommandOptionType, ComponentType, MessageFlags, type APIMediaGalleryComponent, type APITextDisplayComponent } from "discord.js";
import { cardImageUrl, SET_NAMES, type Card } from "./card-match.js";
import { PACK_DISCLAIMER, PACK_SETS, type PackCard, type PackPrinting } from "./packs.js";
import type { V2 } from "./riftbound-reply.js";

export const PACK_COMMAND = {
  name: "pack",
  description: "An unofficial booster simulation, for fun",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "open",
      description: "Open a simulated pack of a set: not a real pull, never added to your collection",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "set",
          description: "The set (Origins if left out)",
          choices: PACK_SETS.map((code) => ({ name: SET_NAMES[code] ?? code, value: code })),
        },
      ],
    },
  ],
} as const;

export const packWaitText = (seconds: number) => `One pack per minute: you can open another in ${seconds} s.`;

/** The opened pack: its cards' images in two galleries (Discord takes 10 per gallery), the foil named, and the disclaimer. */
export function packMessage(set: string, pack: PackCard<PackPrinting & { card_id: string; image_url: string | null }>[], cards: Card[], opener: string): V2 {
  const text = (content: string): APITextDisplayComponent => ({ type: ComponentType.TextDisplay, content });
  const name = (p: { card_id: string }) => cards.find((c) => c.id === p.card_id)?.name ?? p.card_id;
  const label = (c: (typeof pack)[number]) => `${name(c.printing)}${c.foil ? " (foil)" : ""}`;
  const shown = pack.filter((c) => c.printing.image_url);
  const gallery = (part: typeof pack): APIMediaGalleryComponent[] =>
    part.length ? [{ type: ComponentType.MediaGallery, items: part.map((c) => ({ media: { url: cardImageUrl(c.printing.image_url!, 300) }, description: label(c) })) }] : [];
  const half = Math.ceil(shown.length / 2);
  const foil = pack.find((c) => c.foil);
  return {
    components: [
      {
        type: ComponentType.Container,
        components: [
          text(`### ${opener} opened a simulated ${SET_NAMES[set] ?? set} pack`),
          ...gallery(shown.slice(0, half)),
          ...gallery(shown.slice(half)),
          text([...(foil ? [`Foil: **${name(foil.printing)}**`] : []), `-# ${PACK_DISCLAIMER}`].join("\n")),
        ],
      },
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}
