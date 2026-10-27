const DDRAGON = "https://ddragon.leagueoflegends.com";

export interface Champion {
  /** Riot's id as Data Dragon names it, what is stored ("MonkeyKing"). */
  id: string;
  /** What people call it ("Wukong"). */
  name: string;
}

// Case, accents, spaces and punctuation ignored: "wukong", "Kai'Sa", "lee sin", "Nunu & Willump".
const key = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The champion a typed name or id stands for; null for none or a mere part of one. */
export function findChampion(champions: Champion[], typed: string): Champion | null {
  const k = key(typed);
  return (k && champions.find((c) => key(c.id) === k || key(c.name) === k)) || null;
}

/** Autocomplete for the champion option: names starting with what is typed first, then the rest that contain it. */
export function championChoices(champions: Champion[], typed: string): { name: string; value: string }[] {
  const k = key(typed);
  const hits = champions.filter((c) => key(c.name).includes(k) || key(c.id).includes(k));
  const starts = (c: Champion) => (key(c.name).startsWith(k) ? 0 : 1);
  return hits
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((c) => ({ name: c.name, value: c.id }));
}

/** Data Dragon's champion.json `data`, to the list above. */
export function parseChampions(data: Record<string, { id: string; name: string }>): Champion[] {
  return Object.values(data).map((c) => ({ id: c.id, name: c.name }));
}

let cache: { at: number; list: Champion[] } | null = null;

/** The latest patch's champions, refreshed daily (a new champion comes with a patch). */
export async function loadChampions(): Promise<Champion[]> {
  if (cache && Date.now() - cache.at < 24 * 3600_000) return cache.list;
  const signal = AbortSignal.timeout(5_000);
  const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`, { signal })).json()) as string[];
  const { data } = await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`, { signal })).json();
  cache = { at: Date.now(), list: parseChampions(data) };
  return cache.list;
}
