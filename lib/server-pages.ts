/** A server's tabs, grouped, in header order. A group with one page is a plain tab. */
export const SERVER_GROUPS = [
  {
    label: "Stats",
    pages: [
      { page: "leaderboard", label: "Leaderboard" },
      { page: "channels", label: "Channels" },
      { page: "emoji", label: "Emoji" },
      { page: "timeline", label: "Timeline" },
      { page: "games", label: "What we play" },
    ],
  },
  {
    label: "Local play",
    pages: [
      { page: "stores", label: "Where we play" },
      { page: "trades", label: "Trades" },
    ],
  },
  { label: "League", pages: [{ page: "ranked", label: "Ranked" }] },
];

export const SERVER_PAGES = SERVER_GROUPS.flatMap((g) => g.pages);

/** Where the server switcher goes: the same tab on the other server, else its leaderboard. */
export function switchPath(pathname: string, guildId: string) {
  // A member or a recap may not exist on the other server, so those pages do not carry over.
  const page = pathname.split("/")[3];
  return `/s/${guildId}/${SERVER_PAGES.some((p) => p.page === page) ? page : "leaderboard"}`;
}
