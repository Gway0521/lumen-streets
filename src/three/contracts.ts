export type Point = number[];
export type Bounds = [number, number, number, number];
export interface RoadFeature {
  id?: string | number;
  geometry: { type: string; coordinates: number[][] | number[][][] };
  properties?: Record<string, string | number | boolean>;
}
export interface BuildRequest {
  type: "build";
  generation: number;
  city: string | null;
  center: Point;
  bounds: Bounds;
  roads: RoadFeature[];
  tileURL: string;
  heightURL: string;
  base: string;
  refreshHeights?: boolean;
  mobile: boolean;
  zoom: number;
  surfaceKey?: string | null;
  limit: number;
}
export type WorkerRequest = BuildRequest | { type: "cancel" | "clear" };
export type HeightMethod = "survey" | "mapped" | "levels" | "model" | "raster" | "regional" | "fallback";
export interface HeightProperties {
  lumen_height_version: 1;
  height_m: number;
  min_height_m: number;
  height_raw?: number | null;
  floors_raw?: number | null;
  height_method: HeightMethod;
  height_source: string;
  height_definition: "ground_to_top" | "ground_to_roof" | "roof_mean" | "roof_unspecified" | "cell_mean";
  height_missing: boolean;
  height_estimated: boolean;
  height_match: number;
  height_year?: number | null;
  height_conflict?: boolean;
}
export interface HeightFeature {
  type: "Feature";
  id: string;
  properties: HeightProperties;
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
}
export interface HeightTile {
  type: "FeatureCollection";
  features: HeightFeature[];
  lumen?: { revision?: string; status?: string; attribution?: string[] };
}
export interface HeightManifest {
  version: 2;
  global: true;
  zoom: 14;
  tiles: string;
  revision?: string;
  attribution: string[];
}
export interface CarRecipe<Edge = string> {
  id: number; edge: Edge; next: Edge | null; s: number; speed: number;
  maxSpeed: number; length: number; bus: boolean; age: number; stopped: number;
}
export interface TrafficRecipe<Edge = string> {
  time: number; serial: number; randomState: number; cars: CarRecipe<Edge>[];
}
export interface SceneRecipe {
  format: "lumen-streets-view";
  version: 1;
  view: { lng: number; lat: number; zoom: number; bearing: number; pitch: number; glow: number; density: number; city: string };
  name: string;
  time: number;
  playing: boolean;
  viewLabels: boolean;
  aspect: number;
  composition: {
    quiet: { edge: "none" | "left" | "right" | "top" | "bottom"; brightness: number; area: number };
    placeTitle?: { text: string; corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size: "small" | "medium" | "large" };
    landmarkLabels: boolean;
    locale: "en" | "zh-TW";
  };
  traffic: TrafficRecipe | null;
}
export type GeometryBuffers = Record<"position" | "normal" | "uv" | "color" | "seed" | "facade" | "beacons" | "boxes", Float32Array>;
export type GeometryResult = GeometryBuffers & {
  buildings: number; truncated: boolean; landmarks: unknown[]; placeLabels: unknown[];
  landmarkVertices: number; landmarkCount: number; landmarkOmitted: number; aggregated: number;
  tileCount: number; tileLimited: boolean; tileCacheMiB: number; preparedTileCount: number;
  heightAttribution: string[]; heightRevision: string | null; heightSummary: Partial<Record<HeightMethod, number>>;
  heightPending: boolean; heightStatus: string[];
  tileMetrics: { hits: number; misses: number; requests: number };
};
export interface BuildSuccess {
  generation: number;
  cancelled?: false;
  error?: undefined;
  origin: Point;
  geometry: GeometryResult;
  graph: ReturnType<typeof import("./graph-wire.js").packGraph>;
  routes: unknown[];
  surface?: { bitmap: ImageBitmap; a: Point; b: Point } | null;
  surfaceKey: string | null;
  environment: { water: Float32Array; green: Float32Array; bridges: Float32Array; lamps: Float32Array;
    trees: Float32Array; a: Point; b: Point; light: ImageBitmap };
}
export interface BuildFailure {
  generation: number;
  cancelled: boolean;
  error: string;
  surface?: undefined;
  environment?: undefined;
}
export type WorkerResult = BuildSuccess | BuildFailure;
