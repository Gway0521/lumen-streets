import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { selection, searchInput, MapRequestError } from "../src/search/area.js";
import { validateMap } from "../src/search/validate.js";

const hash = text => createHash("sha256").update(text).digest("hex");
const DAY = 86400000;
export const SOURCE_VERSION = "overpass-area-v2";
export function mapQuery(area, rail = false) {
  const b = selection(area).bbox.join(",");
  const filters = rail ? ['way[railway~"^(rail|subway|light_rail|tram)$"]', 'node[railway~"^(station|halt|stop)$"]'] : [
    'way[building]', 'way["building:part"]', 'way[man_made~"^(tower|mast)$"]', 'node[man_made~"^(tower|mast)$"]',
    'way[highway]', 'way[leisure~"^(park|garden|pitch|playground|sports_centre)$"]',
    'way[landuse~"^(grass|forest|recreation_ground)$"]', 'way[natural~"^(water|wood)$"]', 'way[waterway=riverbank]',
    'relation[building][type=multipolygon]', 'relation["building:part"][type=multipolygon]', 'relation[type=building]',
    'relation[natural=water][type=multipolygon]', 'relation[leisure=park][type=multipolygon]',
  ];
  return `[out:json][timeout:30][maxsize:33554432];(${filters.map(f => `${f}(${b});`).join("")});${rail ? '' : '(._;way(r);relation(r)[type=multipolygon];);(._;way(r););'}out body geom;`;
}
function endpoint(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search)
    throw new Error("Map service endpoints must be HTTPS URLs without credentials, queries or fragments");
  return u.href;
}
export function createMapService({
  fetcher = fetch, cacheDir = ".cache/maps", now = Date.now,
  photon = process.env.LUMEN_PHOTON_URL || "https://photon.komoot.io/api/",
  overpass = process.env.LUMEN_OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  interval = 1500, timeout = 40000, budget = 128000000,
  searchLimit = 100, mapLimit = 60, userAgent = "LumenStreets/0.1",
} = {}) {
  photon = endpoint(photon); overpass = endpoint(overpass);
  const lanes = { search: { active: false, next: 0 }, map: { active: false, next: 0 } };
  let usage, writing = Promise.resolve();
  let cacheWrites = Promise.resolve();
  const pending = new Set();
  const ready = (async () => {
    await mkdir(cacheDir, { recursive: true });
    try { usage = JSON.parse(await readFile(join(cacheDir, "usage.json"), "utf8")); } catch { usage = {}; }
    await prune();
  })();
  async function prune() {
    const files = [];
    for (const name of await readdir(cacheDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(cacheDir, name), info = await stat(path);
      files.push({ path, size: info.size, time: info.mtimeMs });
    }
    files.sort((a, b) => b.time - a.time);
    let total = 0;
    for (const f of files) { total += f.size; if (total > budget || now() - f.time > 7 * DAY) await unlink(f.path); }
  }
  async function persistUsage() {
    writing = writing.catch(() => {}).then(async () => {
      await writeFile(join(cacheDir, "usage.tmp"), JSON.stringify(usage));
      await rename(join(cacheDir, "usage.tmp"), join(cacheDir, "usage.json"));
    });
    await writing;
  }
  async function cached(key, ttl, signal, get) {
    await ready; signal.throwIfAborted();
    if (pending.has(key)) throw new MapRequestError("quota", 429, 2);
    pending.add(key);
    try {
      const path = join(cacheDir, hash(key) + ".json");
      try {
        const info = await stat(path);
        if (now() - info.mtimeMs < ttl && info.size <= 24000000) {
          const value = JSON.parse(await readFile(path, "utf8"));
          signal.throwIfAborted();
          return { ...value, cache: "hit" };
        }
      } catch (e) { if (signal.aborted) throw e; }
      const value = await get(); signal.throwIfAborted();
      // Pending keys prevent duplicate misses. Atomic replacement avoids partial cache entries.
      cacheWrites = cacheWrites.catch(() => {}).then(async () => {
        await writeFile(path + ".tmp", JSON.stringify(value));
        await rename(path + ".tmp", path);
        await prune();
      });
      await cacheWrites;
      return { ...value, cache: "miss" };
    } finally { pending.delete(key); }
  }
  async function request(kind, url, options, signal, maxBytes) {
    await ready; signal.throwIfAborted();
    const lane = lanes[kind], day = Math.floor(now() / DAY);
    if (usage.day !== day) usage = { day, search: 0, map: 0, bytes: 0 };
    lane.next = Math.max(lane.next, usage[kind + "Next"] || 0);
    if (lane.active || now() < lane.next) throw new MapRequestError("quota", 429, Math.max(2, Math.ceil((lane.next - now()) / 1000)));
    if (usage[kind] >= (kind === "search" ? searchLimit : mapLimit) || usage.bytes >= budget)
      throw new MapRequestError("dailyLimit", 429, Math.ceil(((day + 1) * DAY - now()) / 1000));
    lane.active = true; lane.next = now() + interval; usage[kind]++;
    usage[kind + "Next"] = lane.next;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    try {
      await persistUsage();
      const response = await fetcher(url, { ...options, signal: combined, redirect: "error", headers: {
        "User-Agent": userAgent, Accept: "application/json", ...options.headers,
      } });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status === 504 || response.status === 503) {
          const header = response.headers.get("retry-after");
          const seconds = /^\d+$/.test(header || "") ? Number(header) : Math.ceil((Date.parse(header) - now()) / 1000);
          const retry = Math.max(60, Number.isFinite(seconds) ? seconds : 60);
          lane.next = now() + retry * 1000;
          usage[kind + "Next"] = lane.next;
          throw new MapRequestError("quota", 429, retry);
        }
        throw new MapRequestError("unavailable", 502);
      }
      if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new MapRequestError("tooDense", 413); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        combined.throwIfAborted(); bytes += chunk.length; usage.bytes += chunk.length;
        if (bytes > maxBytes || usage.bytes > budget) throw new MapRequestError("tooDense", 413);
        chunks.push(chunk);
      }
      combined.throwIfAborted();
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MapRequestError("badData", 502); }
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      if (combined.aborted) throw new MapRequestError("timeout", 504);
      if (e instanceof MapRequestError) throw e;
      throw new MapRequestError("unavailable", 502);
    } finally { lane.active = false; await persistUsage(); }
  }
  return {
    ready,
    async search(input, signal) {
      const { query, locale } = searchInput(input);
      return cached(JSON.stringify(["photon-v1", photon, query, locale]), DAY, signal, async () => {
        const url = new URL(photon); url.searchParams.set("q", query); url.searchParams.set("limit", "6");
        if (locale === "en") url.searchParams.set("lang", "en");
        const raw = await request("search", url, {}, signal, 1000000);
        if (!Array.isArray(raw?.features)) throw new MapRequestError("badData", 502);
        const results = raw.features.slice(0, 6).flatMap(f => {
          const p = f?.properties, center = f?.geometry?.coordinates;
          if (!p || typeof p.name !== "string" || !Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 80) return [];
          const context = [...new Set([p.street, p.city, p.state, p.country].filter(v => typeof v === "string" && v !== p.name))].join(", ").slice(0, 240);
          return [{ id: `${String(p.osm_type).slice(0, 10)}/${String(p.osm_id).slice(0, 20)}`, name: p.name.slice(0, 120), context, kind: String(p.osm_value || p.type || "place").slice(0, 40), center }];
        });
        return { results, provider: "Photon", attribution: "© OpenStreetMap contributors", retrievedAt: new Date(now()).toISOString() };
      });
    },
    async map(input, signal) {
      const area = selection(input), rail = input.rail === true;
      return cached(JSON.stringify([SOURCE_VERSION, overpass, area.bbox, rail]), 7 * DAY, signal, async () => {
        const raw = validateMap(await request("map", overpass, { method: "POST", body: new URLSearchParams({ data: mapQuery(area, rail) }) }, signal, 24000000), rail);
        return { raw, area, provider: "OpenStreetMap/Overpass", sourceVersion: SOURCE_VERSION, sourceURL: overpass,
          retrievedAt: new Date(now()).toISOString(), fingerprint: hash(JSON.stringify(raw)), attribution: "© OpenStreetMap contributors · ODbL" };
      });
    },
  };
}

/** Development keeps its loopback boundary; the standalone server supplies its own guard. */
export function localRequest(req) {
  const host = req.headers.host || "", address = req.socket.remoteAddress;
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address) ||
    (req.headers.origin && req.headers.origin !== `http://${host}`) ||
    ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"])) throw new MapRequestError("forbidden", 403);
}
export function mapMiddleware(service = createMapService(), { authorize = localRequest, onError = () => {} } = {}) {
  return async (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/")) return next();
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    req.on("aborted", () => controller.abort());
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      authorize(req, res);
      if (path === "/api/capabilities" && req.method === "GET") return res.end(JSON.stringify({ search: true }));
      if (!["/api/search", "/api/map"].includes(path)) throw new MapRequestError("notFound", 404);
      if (req.method !== "POST" || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new MapRequestError("invalidRequest", 400);
      if (Number(req.headers["content-length"]) > 4096) throw new MapRequestError("invalidRequest", 413);
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) throw new MapRequestError("invalidRequest", 413); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new MapRequestError("invalidRequest", 400); }
      const value = await (path === "/api/search" ? service.search(input, controller.signal) : service.map(input, controller.signal));
      if (!controller.signal.aborted) res.end(JSON.stringify(value));
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;
      if (!error.status || error.status >= 500) onError(error);
      if (!req.complete) res.setHeader("Connection", "close");
      res.statusCode = error.status || 500;
      if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      res.end(JSON.stringify({ error: error.code || "unavailable", retryAfter: error.retryAfter || 0 }));
    }
  };
}
export function localMapsPlugin(options) {
  let middleware;
  const install = server => { middleware ||= mapMiddleware(createMapService(options)); server.middlewares.use(middleware); };
  return { name: "local-maps", configureServer: install, configurePreviewServer: install };
}
