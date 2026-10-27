export const DDRAGON = "https://ddragon.leagueoflegends.com";

// Match-V5 sends ids ("LeeSin", "MonkeyKing", sometimes "FiddleSticks"); people write names
// ("Lee Sin", "Wukong"). Both spellings, without case, accents or punctuation, find the champion.
export const championKey = (champion: string) =>
  champion.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
const key = championKey;

type ChampionData = Record<string, { id: string; name: string; image: { full: string } }>;

export interface Champion {
  /** Riot's id, as stored ("MonkeyKing"). */
  id: string;
  /** What people call it ("Wukong"). */
  name: string;
  icon: string;
}

/** Every champion with its Data Dragon icon, by name: the Settings picker. */
export function championList(version: string, champions: ChampionData): Champion[] {
  return Object.values(champions)
    .map((c) => ({ id: c.id, name: c.name, icon: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether a search box's text finds the champion: part of its name or id, normalised. */
export const championMatches = (c: Pick<Champion, "id" | "name">, query: string) =>
  key(c.name).includes(key(query)) || key(c.id).includes(key(query));

/** Champion name or id, normalised, to its square icon on Data Dragon (Riot's own CDN). */
export function championIcons(version: string, champions: ChampionData): Record<string, string> {
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
