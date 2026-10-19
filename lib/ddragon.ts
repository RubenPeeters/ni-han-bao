export const DDRAGON = "https://ddragon.leagueoflegends.com";

// Match-V5 sends ids ("LeeSin", "MonkeyKing", sometimes "FiddleSticks"); people write names
// ("Lee Sin", "Wukong"). Both spellings, without case or punctuation, find the champion.
const key = (champion: string) => champion.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Champion name or id, normalised, to its square icon on Data Dragon (Riot's own CDN). */
export function championIcons(
  version: string,
  champions: Record<string, { id: string; name: string; image: { full: string } }>,
): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const c of Object.values(champions)) {
    const url = `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`;
    icons[key(c.id)] = url;
    icons[key(c.name)] = url;
  }
  return icons;
}

export function championIcon(icons: Record<string, string>, champion: string): string | null {
  return icons[key(champion)] ?? null;
}
