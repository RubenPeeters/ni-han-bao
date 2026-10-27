import { DDRAGON, championIcons, championList, type Champion } from "@/lib/ddragon";
import { cacheLife } from "next/cache";

/** The latest patch's champion data, the same for every visitor; null when Data Dragon is down. */
async function loadChampionData() {
  "use cache";
  cacheLife("hours");
  try {
    const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
    const { data } = await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json();
    return { version, data };
  } catch {
    // shortcut: a failed fetch is cached for the hour too (no icons until then), fine for decoration.
    return null;
  }
}

/** Champion name or id to its icon; empty when Data Dragon is down. */
export async function loadChampionIcons(): Promise<Record<string, string>> {
  const d = await loadChampionData();
  return d ? championIcons(d.version, d.data) : {};
}

/** Every champion, by name; empty when Data Dragon is down. */
export async function loadChampions(): Promise<Champion[]> {
  const d = await loadChampionData();
  return d ? championList(d.version, d.data) : [];
}
