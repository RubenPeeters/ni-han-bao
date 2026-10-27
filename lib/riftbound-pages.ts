const CATALOGUE = [
  { href: "/cards", label: "Cards" },
  { href: "/decks", label: "Decks" },
  { href: "/packs", label: "Open a pack" },
];
const MINE = [
  { href: "/collection", label: "My collection" },
  { href: "/loans", label: "My loans" },
  { href: "/wishlist", label: "My wishlist" },
];

/** The Riftbound row: the catalogue for everyone, plus the logged-in member's own pages. */
export function riftboundTabs(loggedIn: boolean) {
  return loggedIn ? [...CATALOGUE, ...MINE] : CATALOGUE;
}

/**
 * The Riftbound tab the pathname is on, if any: a card or a deck page counts as its list.
 * Logged out, /collection is still a Riftbound page (its log-in prompt), so all tabs count.
 */
export function currentRiftboundTab(pathname: string | null) {
  return [...CATALOGUE, ...MINE].find(({ href }) => pathname === href || !!pathname?.startsWith(`${href}/`))?.href;
}
