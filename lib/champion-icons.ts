import { DDRAGON, championIcons, championList, type Champion } from "@/lib/ddragon";
import { cacheLife } from "next/cache";

/** The latest patch's champion.json, the same for every visitor; null when Data Dragon is down. */
async function loadChampionData() {
  "use cache";
  cacheLife("hours");
  try {
    const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
    const { data } = await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json();
    return { version: version as string, data };
  } catch {
    // shortcut: a failed fetch is cached for the hour too (no champions until then), fine for decoration.
    return null;
  }
}

/** The latest patch's icons; empty when Data Dragon is down. */
export async function loadChampionIcons(): Promise<Record<string, string>> {
  const loaded = await loadChampionData();
  return loaded ? championIcons(loaded.version, loaded.data) : {};
}

/** Every champion of the latest patch, by name; empty when Data Dragon is down. */
export async function loadChampions(): Promise<Champion[]> {
  const loaded = await loadChampionData();
  return loaded ? championList(loaded.version, loaded.data) : [];
}
