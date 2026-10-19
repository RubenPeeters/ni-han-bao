import { DDRAGON, championIcons } from "@/lib/ddragon";
import { cacheLife } from "next/cache";

/** The latest patch's icons, the same for every visitor; empty when Data Dragon is down. */
export async function loadChampionIcons(): Promise<Record<string, string>> {
  "use cache";
  cacheLife("hours");
  try {
    const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
    const { data } = await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json();
    return championIcons(version, data);
  } catch {
    // shortcut: a failed fetch is cached for the hour too (no icons until then), fine for decoration.
    return {};
  }
}
