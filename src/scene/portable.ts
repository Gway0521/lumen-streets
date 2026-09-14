import { createSceneData, sceneOriginals, loadSceneData, type SceneData, type SceneRegion, type PresetId } from "./data.ts";
import { validateRecipe, type SceneRecipe } from "./recipe.ts";
import { regions } from "../city.js";
import { validateMap } from "../search/validate.js";

export const SCENE_FILE_LIMIT = 40_000_000;
export const SCENE_LICENSE = "https://www.openstreetmap.org/copyright";
export interface SceneView { width: number; height: number }
export interface PortableScene {
  format: "lumen-streets-scene"; version: 1; license: typeof SCENE_LICENSE;
  source: { id: string; region: SceneRegion; mapText: string; railText: string | null };
  recipe: SceneRecipe; view: SceneView;
}
export class SceneFileError extends Error {
  code: "sceneInvalid" | "sceneTooLarge" | "sceneMismatch";
  constructor(code: "sceneInvalid" | "sceneTooLarge" | "sceneMismatch" = "sceneInvalid") { super(code); this.code = code; }
}
const fail = (): never => { throw new SceneFileError(); };
const finite = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
export function validateView(input: unknown): SceneView {
  const v = input as SceneView;
  if (!v || !finite(v.width, 128, 8192) || !finite(v.height, 128, 8192)) fail();
  return { width: v.width, height: v.height };
}
/** Bound bytes and nesting before JSON.parse; never execute file content or fetch its source URLs. */
export function boundedJSON(text: string, limit = SCENE_FILE_LIMIT): any {
  if (typeof text !== "string") fail();
  if (text.length > limit || new TextEncoder().encode(text).byteLength > limit) throw new SceneFileError("sceneTooLarge");
  let quoted = false, escaped = false, depth = 0;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") { if (++depth > 32) fail(); }
    else if (c === "}" || c === "]") depth--;
  }
  try { return JSON.parse(text, (key, value) => { if (["__proto__", "prototype", "constructor"].includes(key)) fail(); return value; }); }
  catch { return fail(); }
}
function validateRegion(r: any): asserts r is SceneRegion {
  if (!r || typeof r !== "object" || Array.isArray(r) ||
      !Object.keys(r).every(k => ["name", "english", "subtitle", "description", "center", "bbox", "labels"].includes(k))) fail();
  for (const k of ["name", "english", "subtitle", "description"]) if (typeof r[k] !== "string" || r[k].length > 240) fail();
  if (!Array.isArray(r.center) || r.center.length !== 2 || !finite(r.center[0], -180, 180) || !finite(r.center[1], -80, 80) ||
      !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.bbox.every(Number.isFinite)) fail();
  const [s, w, n, e] = r.bbox, [lon, lat] = r.center;
  const width = (e - w) * 111320 * Math.cos(lat * Math.PI / 180), height = (n - s) * 111320;
  if (w < -180 || e > 180 || s < -80 || n > 80 || lon < w || lon > e || lat < s || lat > n ||
      !finite(width, 900, 4500) || !finite(height, 900, 4500)) fail();
  if (r.labels !== undefined && (!Array.isArray(r.labels) || r.labels.length > 64 || r.labels.some((s: unknown) => typeof s !== "string" || s.length > 240))) fail();
}
function validateSnapshot(text: string, region: SceneRegion, rail: boolean) {
  const raw = boundedJSON(text, 16_000_000);
  validateMap(raw, rail);
  const meta = raw.pocketPlaces;
  if (!meta || typeof meta.attribution !== "string" || meta.attribution.length > 512 || !meta.attribution.includes("OpenStreetMap") ||
      typeof meta.source !== "string" || meta.source.length > 2048) fail();
  try { const u = new URL(meta.source); if (u.protocol !== "https:" || u.username || u.password) fail(); } catch { fail(); }
  const [lon, lat] = region.center;
  const point = (p: any) => { if (Math.abs(p.lat - lat) > .25 || Math.abs((p.lon - lon) * Math.cos(lat * Math.PI / 180)) > .25) fail(); };
  for (const e of raw.elements) { if (e.type === "node") point(e); e.geometry?.forEach(point); e.members?.forEach((m: any) => m.geometry?.forEach(point)); }
}
export function sceneFile(data: SceneData, recipe: SceneRecipe, view: SceneView): Blob {
  const source = sceneOriginals(data);
  for (const text of [source.mapText, source.railText]) if (text && new TextEncoder().encode(text).byteLength > 16_000_000)
    throw new SceneFileError("sceneTooLarge");
  const value: PortableScene = { format: "lumen-streets-scene", version: 1, license: SCENE_LICENSE,
    source: { id: data.id, ...source }, recipe: validateRecipe(recipe, data), view: validateView(view) };
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
  if (blob.size > SCENE_FILE_LIMIT) throw new SceneFileError("sceneTooLarge");
  return blob;
}
export async function readSceneFile(file: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (file.size > SCENE_FILE_LIMIT) throw new SceneFileError("sceneTooLarge");
  const text = await file.text(); signal?.throwIfAborted();
  try {
    const f = boundedJSON(text) as PortableScene;
    if (f?.format !== "lumen-streets-scene" || f.version !== 1 || f.license !== SCENE_LICENSE ||
        !f.source || typeof f.source.id !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(f.source.id)) fail();
    const { id, region, mapText, railText } = f.source;
    validateRegion(region); const view = validateView(f.view);
    validateSnapshot(mapText, region, false);
    if (railText !== null) validateSnapshot(railText, region, true);
    // Exact files require checkpoints, avoiding long synchronous replay of an untrusted recipe.
    if (!f.recipe?.checkpoint) fail();
    signal?.throwIfAborted();
    const data = await createSceneData(id, mapText, railText, region); signal?.throwIfAborted();
    if (data.fingerprint !== f.recipe.dataFingerprint) throw new SceneFileError("sceneMismatch");
    return { data, recipe: validateRecipe(f.recipe, data), view };
  } catch (error) { signal?.throwIfAborted(); if (error instanceof SceneFileError) throw error; throw new SceneFileError(); }
}

export interface SceneReference { version: 1; rail: boolean; recipe: SceneRecipe; view: SceneView }
/** A small link preserves composition/settings and deterministically starts traffic at eight seconds. */
export function sceneReference(data: SceneData, recipe: SceneRecipe, view: SceneView): SceneReference | null {
  if (!Object.hasOwn(regions, data.id)) return null;
  const r = validateRecipe(recipe, data); delete r.checkpoint; r.simulationTime = 8; r.remainder = 0;
  const ref: SceneReference = { version: 1, rail: !!data.source.rail, recipe: r, view: validateView(view) };
  return new TextEncoder().encode(JSON.stringify(ref)).byteLength <= 4500 ? ref : null;
}
export function encodeReference(ref: SceneReference) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(ref)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function decodeReference(encoded: string): SceneReference {
  if (encoded.length > 6000 || !/^[\w-]+$/.test(encoded)) fail();
  try {
    const r = boundedJSON(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0))), 4500);
    if (r?.version !== 1 || typeof r.rail !== "boolean" || !r.recipe || !Object.hasOwn(regions, r.recipe.dataId) ||
        typeof r.recipe.dataFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(r.recipe.dataFingerprint) ||
        r.recipe.checkpoint !== undefined || r.recipe.simulationTime !== 8 || r.recipe.remainder !== 0) fail();
    r.view = validateView(r.view);
    r.recipe = validateRecipe(r.recipe, { schemaVersion: 1, id: r.recipe.dataId, fingerprint: r.recipe.dataFingerprint } as SceneData);
    return r;
  } catch { return fail(); }
}
export async function resolveReference(ref: SceneReference, signal?: AbortSignal) {
  const data = await loadSceneData(ref.recipe.dataId as PresetId, signal, ref.rail);
  signal?.throwIfAborted();
  if (data.fingerprint !== ref.recipe.dataFingerprint) throw new SceneFileError("sceneMismatch");
  return { data, recipe: validateRecipe(ref.recipe, data), view: ref.view };
}
/** Only operator-hosted JSON inside this application's directory; never follow embedded source URLs. */
export function hostedSceneURL(path: string, base: string) {
  const root = new URL("./", base), url = new URL(path, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || !url.pathname.endsWith(".lumen.json") ||
      url.username || url.password || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) fail();
  return url;
}
export async function fetchSceneFile(path: string, base: string, signal: AbortSignal) {
  const url = hostedSceneURL(path, base);
  const response = await fetch(url, { signal, redirect: "error", credentials: "omit" });
  if (!response.ok || !response.body) fail();
  const reader = response.body!.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  try {
    while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength;
      if (bytes > SCENE_FILE_LIMIT) throw new SceneFileError("sceneTooLarge"); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  return readSceneFile(new Blob(chunks), signal);
}
