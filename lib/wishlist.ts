// Riftbound wishlist (#177). What is still wanted is worked out in the bot's package, which
// DMs trade matches (#178) from it.
export { fits, wishlist, type Wanted, type WishRow } from "@/bot/src/wishlist";

/** The database's wishlist_mode values, on decks and as a member's default. */
export const WISHLIST_MODES = [
  { value: "none", label: "Not on my wishlist", hint: "The deck adds nothing to your wishlist." },
  { value: "shared", label: "Shared", hint: "Cards move between decks: your wishlist takes the largest need among them." },
  { value: "dedicated", label: "Dedicated", hint: "The deck stays built: its needs add up with the others'." },
] as const;
export type WishlistMode = (typeof WISHLIST_MODES)[number]["value"];
