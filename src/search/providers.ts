import { createSceneData, type SceneData, type SceneRegion } from "../scene/data.ts";
import { selection, MapRequestError } from "./area.js";
import { validateMap } from "./validate.js";

export interface PlaceResult { id: string; name: string; context: string; kind: string; center: [number, number] }
export interface AreaSelection { center: [number, number]; size: 1 | 2 | 4 }
export interface Geocoder {
  search(query: string, locale: "en" | "zh-TW", signal: AbortSignal): Promise<PlaceResult[]>;
}
export interface MapDataSource {
  load(area: AreaSelection, name: string, signal: AbortSignal, progress: (stage: string) => void): Promise<SceneData>;
}
async function post(path: string, input: unknown, signal: AbortSignal) {
  let response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
    });
  } catch (error) { signal.throwIfAborted(); throw new MapRequestError("unavailable", 502); }
  let value;
  try { value = await response.json(); } catch { throw new MapRequestError("unavailable", 502); }
  if (!response.ok) throw new MapRequestError(value.error || "unavailable", response.status, value.retryAfter || 0);
  signal.throwIfAborted();
  return value;
}
export const geocoder: Geocoder = {
  async search(query, locale, signal) { return (await post("search", { query, locale }, signal)).results; },
};
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});
export async function importedScene(areaInput: AreaSelection, name: string, map: any, rail: any): Promise<SceneData> {
  const area = selection(areaInput);
  const verify = async (value: any, optional: boolean) => {
    if (value?.sourceVersion !== "overpass-area-v1" || JSON.stringify(value.area) !== JSON.stringify(area) ||
      typeof value.sourceURL !== "string" || !value.sourceURL.startsWith("https://") ||
      !Number.isFinite(Date.parse(value.retrievedAt))) throw new MapRequestError("badData", 502);
    validateMap(value.raw, optional);
    const bytes = new TextEncoder().encode(JSON.stringify(value.raw));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (digest !== value.fingerprint) throw new MapRequestError("badData", 502);
  };
  await verify(map, false);
  if (rail) { try { await verify(rail, true); } catch { rail = null; } }
  const id = `area-${area.center.join("_")}-${area.size}`;
  const title = name.slice(0, 120);
  const region: SceneRegion = {
    name: title, english: title, subtitle: "", description: "",
    center: area.center, bbox: area.bbox, labels: [],
  };
  const snapshot = (value: any) => JSON.stringify({ ...value.raw, pocketPlaces: {
    region: id, bbox: area.bbox, source: value.sourceURL, retrievedAt: value.retrievedAt,
    attribution: "© OpenStreetMap contributors · ODbL", sourceVersion: value.sourceVersion, fingerprint: value.fingerprint,
  } });
  const mapText = snapshot(map), railText = rail ? snapshot(rail) : null;
  if (mapText.length > 16000000 || (railText?.length || 0) > 16000000)
    throw new MapRequestError("tooDense", 413);
  return createSceneData(id, mapText, railText, region);
}
export const mapDataSource: MapDataSource = {
  async load(input, name, signal, progress) {
    const area = selection(input);
    progress("loadingMap");
    const map = await post("map", area, signal);
    progress("loadingRail");
    let rail = null;
    try {
      // A second bounded query allows optional rail failures without discarding a valid street map.
      if (map.cache !== "hit") await delay(1600, signal);
      rail = await post("map", { ...area, rail: true }, signal);
    } catch { signal.throwIfAborted(); }
    progress("buildingScene");
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    signal.throwIfAborted();
    const data = await importedScene(input, name, map, rail);
    signal.throwIfAborted();
    return data;
  },
};
