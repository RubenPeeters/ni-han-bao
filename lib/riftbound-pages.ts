/** The Riftbound row: the catalogue for everyone, plus the logged-in member's own pages. */
export function riftboundTabs(me: string | null) {
  const tabs = [
    { href: "/cards", label: "Cards" },
    { href: "/decks", label: "Decks" },
  ];
  if (!me) return tabs;
  return [
    ...tabs,
    { href: `/u/${me}/collection`, label: "My collection" },
    { href: `/u/${me}/loans`, label: "My loans" },
    { href: `/u/${me}/wishlist`, label: "My wishlist" },
  ];
}

/** The Riftbound tab the pathname is on, if any: a card or a deck page counts as its list. */
export function currentRiftboundTab(pathname: string | null, me: string | null) {
  return riftboundTabs(me).find(({ href }) => pathname === href || !!pathname?.startsWith(`${href}/`))?.href;
}
