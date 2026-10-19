/** A server's tabs, in header order. */
export const SERVER_PAGES = [
  { page: "leaderboard", label: "Leaderboard" },
  { page: "channels", label: "Channels" },
  { page: "emoji", label: "Emoji" },
  { page: "timeline", label: "Timeline" },
  { page: "stores", label: "Where we play" },
  { page: "games", label: "What we play" },
  { page: "cards", label: "Cards" },
  { page: "ranked", label: "Ranked" },
];

/** Where the server switcher goes: the same tab on the other server, else its leaderboard. */
export function switchPath(pathname: string, guildId: string) {
  // A member or a recap may not exist on the other server, so those pages do not carry over.
  const page = pathname.split("/")[3];
  return `/s/${guildId}/${SERVER_PAGES.some((p) => p.page === page) ? page : "leaderboard"}`;
}
