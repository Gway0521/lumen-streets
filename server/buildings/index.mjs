import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createOvertureSource, boundsOf, validateTile } from "./source.mjs";
import { createJobs } from "./jobs.mjs";
import { Lane, digest } from "./cache.mjs";
import {
  globalHeight,
  GLOBAL_RELEASE,
  RESOLVER_VERSION,
  OVERTURE_CREDIT,
} from "../../src/buildings/global-height.js";
import { encodeTile } from "../../src/buildings/tile-wire.js";
import { localRequest } from "../maps.mjs";

export function createBuildingService({
  directory = resolve(
    process.env.LUMEN_BUILDINGS_CACHE_DIR || ".cache/global-buildings",
  ),
  source,
  jobs,
  python,
} = {}) {
  const registry = readFileSync(resolve("data/building-sources.json"), "utf8");
  source ||= createOvertureSource({
    cacheDir: join(directory, "tiles"),
    release: JSON.parse(registry).base.release,
  });
  jobs ||= createJobs({ directory, python });
  const lane = new Lane(2, 32),
    inflight = new Map();
  const revision = `${source.release || GLOBAL_RELEASE}/${RESOLVER_VERSION}/${digest(registry).slice(0, 12)}`;
  return {
    manifest: {
      version: 2,
      zoom: 14,
      global: true,
      revision,
      attribution: [OVERTURE_CREDIT],
      tiles: "./{z}/{x}/{y}.json",
    },
    async tile(z, x, y) {
      validateTile(z, x, y);
      const key = `${revision}/${z}/${x}/${y}`;
      if (inflight.has(key)) return inflight.get(key);
      const task = lane.run(async () => {
        const features = await source.features(x, y);
        const enrichment = features.length
          ? await jobs.get(key, features, boundsOf(x, y))
          : { status: "complete", overrides: {}, credits: [], states: {} };
        const rendered = features.map((f) => {
          const properties = enrichment.overrides[f.id] || globalHeight(f);
          return {
            type: "Feature",
            id: f.id,
            geometry: f.geometry,
            properties,
          };
        });
        const credits = [OVERTURE_CREDIT, ...enrichment.credits];
        const value = {
          type: "FeatureCollection",
          features: rendered,
          lumen: {
            revision: `${revision}/${enrichment.updated || 0}`,
            status: enrichment.status,
            states: enrichment.states,
            attribution: credits,
          },
        };
        const json = JSON.stringify(encodeTile(value.features, value.lumen));
        if (Buffer.byteLength(json) > 8 * 1048576)
          throw Error("Building response budget");
        return { body: gzipSync(json), etag: `"${digest(json)}"` };
      });
      inflight.set(key, task);
      try {
        return await task;
      } finally {
        inflight.delete(key);
      }
    },
    close() {
      jobs.close();
    },
  };
}

export function buildingMiddleware(service, { authorize = localRequest } = {}) {
  return async (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/buildings/")) return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-cache");
    try {
      authorize(req, res);
      if (req.method !== "GET")
        throw Object.assign(Error("Method not allowed"), { status: 405 });
      if (path === "/api/buildings/manifest.json")
        return res.end(JSON.stringify(service.manifest));
      const m =
        /^\/api\/buildings\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.json$/.exec(path);
      if (!m) throw Object.assign(Error("Unknown tile"), { status: 404 });
      const result = await service.tile(...m.slice(1).map(Number));
      if (res.destroyed) return;
      res.setHeader("ETag", result.etag);
      res.setHeader("Vary", "Accept-Encoding");
      if (req.headers["if-none-match"] === result.etag) {
        res.statusCode = 304;
        return res.end();
      }
      const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      const body = gzip
        ? result.body
        : gunzipSync(result.body, { maxOutputLength: 8 * 1048576 });
      if (gzip) res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", body.length);
      res.end(body);
    } catch (error) {
      if (res.destroyed) return;
      res.statusCode = error.status || 503;
      res.end(JSON.stringify({ error: "buildingDataUnavailable" }));
      if (!error.status)
        console.warn(
          JSON.stringify({
            event: "building_tile_failed",
            message: error.message,
          }),
        );
    }
  };
}
export function globalBuildingsPlugin(options) {
  const install = (server) => {
    const service = createBuildingService(options);
    server.middlewares.use(buildingMiddleware(service));
    server.httpServer?.once("close", () => service.close());
  };
  return {
    name: "global-buildings",
    configureServer: install,
    configurePreviewServer: install,
  };
}
