/** Where an old single-server URL (/leaderboard, ...) goes: the visitor's only server, else the picker. */
export const legacyPath = (guildIds: string[], page: string) =>
  guildIds.length === 1 ? `/s/${guildIds[0]}/${page}` : "/s";
