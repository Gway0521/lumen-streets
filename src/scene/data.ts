import { parseCity, regions } from "../city.js";
import { parseRail, buildRailRoutes } from "../rail.js";

export type PresetId = keyof typeof regions;
export type SceneRegion = (typeof regions)[PresetId];
export interface MapFeature {
  id: number;
  sourceId: string;
  tags: Record<string, string>;
  nodes?: number[];
  points: number[][];
  holes: number[][][];
}
export interface BuildingFeature extends MapFeature {
  assemblyId: string;
  role: 'body' | 'outline' | 'part';
  relationTags: Record<string, string>;
}
export interface RailTrack extends Omit<MapFeature, "holes" | "nodes"> {
  nodes: number[];
}
export interface RailStation {
  id: number;
  sourceId: string;
  name: string;
  tags: Record<string, string>;
  point: number[];
}
export type Geometry = Omit<
  ReturnType<typeof parseCity>,
  "id" | "features" | "buildings" | "roads" | "land"
> & {
  id: string;
  features: MapFeature[];
  buildings: BuildingFeature[];
  roads: MapFeature[];
  land: MapFeature[];
  rail: Omit<ReturnType<typeof parseRail>, "tracks" | "stations"> & {
    tracks: RailTrack[];
    stations: RailStation[];
  };
  railRoutes: ReturnType<typeof buildRailRoutes>;
  railUnavailable: boolean;
};

/** Local meters: x east, y south; geographic origin is [longitude, latitude]. */
export interface SceneData {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly fingerprint: string;
  readonly projection: {
    readonly kind: "local-equirectangular";
    readonly units: "meters";
    readonly axes: "east-south";
    readonly origin: readonly number[];
  };
  readonly source: {
    readonly provider: "OpenStreetMap/Overpass";
    readonly attribution: string;
    readonly map: SnapshotSource;
    readonly rail: SnapshotSource | null;
  };
  /** Deep-frozen renderer geometry. Numeric art IDs are retained; sourceId is namespaced. */
  readonly geometry: Geometry;
}
interface SnapshotSource {
  url: string;
  retrievedAt: string;
  relationsRetrievedAt?: string;
  fingerprint: string;
}

/** Kept with the immutable data lifetime so custom scenes can travel without a gateway/cache. */
const originals = new WeakMap<SceneData, { region: SceneRegion; mapText: string; railText: string | null }>();
export function sceneOriginals(data: SceneData) {
  const value = originals.get(data);
  if (!value) throw new SceneDataError("Scene source unavailable");
  return { ...value, region: structuredClone(value.region) };
}

export class SceneDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneDataError";
  }
}

export function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSnapshot(text: string, id: string, region: SceneRegion) {
  // Bound normalized snapshot text too; arbitrary sources also pass search/validate.js.
  if (text.length > 16_000_000)
    throw new SceneDataError("Snapshot exceeds the preset data limit");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SceneDataError("Invalid snapshot JSON");
  }
  const source = raw?.pocketPlaces;
  const bbox = source?.bbox;
  if (
    !Array.isArray(raw?.elements) ||
    raw.elements.length > 150_000 ||
    !source ||
    source.region !== id ||
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(Number.isFinite) ||
    bbox.some((n: number, i: number) => n !== region.bbox[i]) ||
    typeof source.source !== "string" ||
    typeof source.attribution !== "string" ||
    !Number.isFinite(Date.parse(source.retrievedAt))
  ) {
    throw new SceneDataError("Invalid preset metadata or elements");
  }
  if (raw.elements.some((e: unknown) => !e || typeof e !== "object"))
    throw new SceneDataError("Invalid map element");
  return raw;
}

export async function createSceneData(
  id: string,
  mapText: string,
  railText: string | null,
  region: SceneRegion = regions[id as PresetId],
): Promise<SceneData> {
  if (!region) throw new SceneDataError("Unknown region");
  const map = parseSnapshot(mapText, id, region);
  const rail = railText === null ? null : parseSnapshot(railText, id, region);
  const mapHash = await digest(mapText),
    railHash = railText === null ? null : await digest(railText);
  const city = parseCity(map, id, region);
  const tracks = rail
    ? parseRail(rail, city.center)
    : { tracks: [], stations: [], source: null };
  const geometry: Geometry = {
    ...city,
    rail: tracks,
    railRoutes: buildRailRoutes(tracks, city.bounds),
    railUnavailable: !rail,
  };
  for (const f of [...city.features, ...tracks.tracks]) {
    if (
      !f.points.every(
        (p: number[]) => p.length === 2 && p.every(Number.isFinite),
      )
    )
      throw new SceneDataError("Invalid projected geometry");
  }
  const metadata = (raw: typeof map, fingerprint: string): SnapshotSource => ({
    url: raw.pocketPlaces.source,
    retrievedAt: raw.pocketPlaces.retrievedAt,
    ...(raw.pocketPlaces.relationsRetrievedAt
      ? { relationsRetrievedAt: raw.pocketPlaces.relationsRetrievedAt }
      : {}),
    fingerprint,
  });
  const data: SceneData = freezeDeep({
    schemaVersion: 1,
    id,
    fingerprint: await digest(
      JSON.stringify({
        version: 1,
        id,
        region,
        mapHash,
        railHash,
      }),
    ),
    projection: {
      kind: "local-equirectangular",
      units: "meters",
      axes: "east-south",
      origin: [...city.center],
    },
    source: {
      provider: "OpenStreetMap/Overpass",
      attribution: map.pocketPlaces.attribution,
      map: metadata(map, mapHash),
      rail: rail && railHash ? metadata(rail, railHash) : null,
    },
    geometry,
  });
  originals.set(data, { region: structuredClone(region), mapText, railText });
  return data;
}

export async function loadSceneData(
  id: PresetId,
  signal?: AbortSignal,
  includeRail = true,
): Promise<SceneData> {
  if (!Object.hasOwn(regions, id)) throw new SceneDataError("Unknown preset");
  const base = import.meta.env.BASE_URL;
  const read = async (suffix: string) => {
    const response = await fetch(`${base}data/${id}${suffix}.json`, { signal });
    if (!response.ok) throw new SceneDataError("Preset snapshot unavailable");
    return response.text();
  };
  const [mapText, railText] = await Promise.all([
    read(""),
    includeRail ? read("-rail").catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    }) : Promise.resolve(null),
  ]);
  signal?.throwIfAborted();
  try {
    return await createSceneData(id, mapText, railText);
  } catch (error) {
    // A broken optional rail snapshot must not prevent opening a valid city.
    if (railText !== null) return createSceneData(id, mapText, null);
    throw error;
  }
}
