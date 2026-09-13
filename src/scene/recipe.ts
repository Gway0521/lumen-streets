import type { SceneData } from "./data.ts";
import { DEFAULT_APPEARANCE, validateAppearance, type Appearance } from "./appearance.ts";

export const RENDERER_VERSION = "aerial-5";
export const STEP = 0.05;
export type Palette = "aerial" | "amber" | "blue";
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface VehicleCheckpoint {
  id: number;
  edge: number;
  next: number | null;
  s: number;
  speed: number;
  maxSpeed: number;
  length: number;
  bus: boolean;
  age: number;
  stopped: number;
}
export interface TrafficCheckpoint {
  time: number;
  serial: number;
  randomState: number;
  cars: VehicleCheckpoint[];
}
export interface SceneRecipe {
  schemaVersion: 1;
  dataId: string;
  dataFingerprint: string;
  rendererVersion: typeof RENDERER_VERSION;
  seed: number;
  palette: Palette;
  appearance?: Appearance;
  density: number;
  /** Optional exact count for deterministic art studies. User density changes clear it. */
  trafficCount?: number;
  trains: boolean;
  underground: boolean;
  playing: boolean;
  camera: Camera;
  simulationTime: number;
  /** Remaining time below a fixed 50 ms simulation step. */
  remainder: number;
  /** Exact live continuation, including random state and changed traffic density. */
  checkpoint?: TrafficCheckpoint;
}

export function createRecipe(data: SceneData): SceneRecipe {
  return {
    schemaVersion: 1,
    dataId: data.id,
    dataFingerprint: data.fingerprint,
    rendererVersion: RENDERER_VERSION,
    seed: data.id === "ntu" ? 41 : 29,
    palette: "aerial",
    appearance: { ...DEFAULT_APPEARANCE },
    density: 80,
    trains: true,
    underground: false,
    playing: true,
    camera: { x: 0, y: 0, zoom: 1 },
    simulationTime: 8,
    remainder: 0,
  };
}

export function validateRecipe(input: unknown, data: SceneData): SceneRecipe {
  const r = input as SceneRecipe;
  const finite = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const fail = () => {
    throw new Error("Invalid or incompatible scene recipe");
  };
  if (
    !r ||
    data.schemaVersion !== 1 ||
    r.schemaVersion !== 1 ||
    ![RENDERER_VERSION, "aerial-4", "aerial-3", "aerial-2", "aerial-1"].includes(r.rendererVersion) ||
    r.dataId !== data.id ||
    r.dataFingerprint !== data.fingerprint ||
    !["aerial", "amber", "blue"].includes(r.palette) ||
    !Number.isInteger(r.seed) ||
    !finite(r.seed, 0, 0xffffffff) ||
    !finite(r.density, 0, 100) ||
    (r.trafficCount !== undefined &&
      (!Number.isInteger(r.trafficCount) ||
        !finite(r.trafficCount, 0, 1100))) ||
    !["trains", "underground", "playing"].every(
      (k) => typeof r[k as keyof SceneRecipe] === "boolean",
    ) ||
    !r.camera ||
    !finite(r.camera.x, -100_000, 100_000) ||
    !finite(r.camera.y, -100_000, 100_000) ||
    !finite(r.camera.zoom, 0.001, 10) ||
    !finite(r.simulationTime, 0, 1e9) ||
    !finite(r.remainder, 0, STEP) ||
    r.remainder >= STEP
  )
    fail();
  const s = r.checkpoint;
  if (s !== undefined && (!s || typeof s !== "object")) fail();
  if (s) {
    if (
      s.time !== r.simulationTime ||
      !Number.isInteger(s.randomState) ||
      !finite(s.randomState, 0, 0xffffffff) ||
      !Number.isInteger(s.serial) ||
      !finite(s.serial, 0, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(s.cars) ||
      s.cars.length > 1100
    )
      fail();
    const ids = new Set();
    for (const c of s.cars) {
      if (
        !c ||
        !Number.isInteger(c.id) ||
        !finite(c.id, 0, s.serial - 1) ||
        ids.has(c.id) ||
        !Number.isInteger(c.edge) ||
        c.edge < 0 ||
        !(c.next === null || (Number.isInteger(c.next) && c.next >= 0)) ||
        !finite(c.s, 0, 100_000) ||
        !finite(c.speed, 0, 100) ||
        !finite(c.maxSpeed, 0, 100) ||
        !finite(c.length, 0.1, 100) ||
        !finite(c.age, 0, 1e9) ||
        !finite(c.stopped, 0, 1e9) ||
        typeof c.bus !== "boolean"
      )
        fail();
      ids.add(c.id);
    }
  } else if (r.simulationTime > 3600) {
    throw new Error("Long scenes require a simulation checkpoint");
  }
  return { ...structuredClone(r), rendererVersion: RENDERER_VERSION, appearance: validateAppearance(r.appearance) };
}
