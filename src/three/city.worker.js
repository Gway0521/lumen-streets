// @ts-check
import { requestBytes, DataHTTPError } from "./request.js";
import { parseCity } from "../shared/city-data.js";
import { regions } from "../shared/regions.js";
import {
  snapshotGeometry,
  vectorGeometry,
  landmarkGeometry,
} from "./geometry.js";
import {
  nearbyLandmarks,
  profileForLandmark,
  landmarkCoverage,
  SHOWCASE_VERTEX_BUDGET,
} from "./showcase.js";
import { buildGraph } from "../traffic.js";
import { parseRail, buildRailRoutes } from "../rail.js";
import { localPoint, snapshotPoint } from "./geo.js";
import { packGraph } from "./graph-wire.js";
import { BuildingTiles } from "./tiles.js";
import { groundSurface } from "./surface.js";
import { compactVolumes } from "./volumes.js";
import { EnvironmentBuilder } from "./environment.js";
import { buildingPolygons } from "./building-source.js";

let cached = null;
const tileSource = new BuildingTiles();
let controller;
const inside = (p, b) =>
  p[0] >= b[1] && p[0] <= b[3] && p[1] >= b[0] && p[1] <= b[2];
async function snapshot(id, base, signal) {
  if (cached?.id === id) return cached;
  const json = async (url) => JSON.parse(new TextDecoder().decode(
    await requestBytes(url, { signal, maximum: 32 * 1048576 })));
  const city = parseCity(await json(`${base}data/${id}.json`), id);
  let routes = [];
  try {
    routes = buildRailRoutes(parseRail(await json(`${base}data/${id}-rail.json`), city.center), city.bounds);
  } catch (error) {
    if (!(error instanceof DataHTTPError && error.status === 404)) throw error;
  }
  signal.throwIfAborted();
  cached = { id, city, routes };
  return cached;
}
/** @param {import("./contracts.ts").WorkerResult} data @param {Transferable[]} [transfer] */
const post = (data, transfer = []) => self.postMessage(data, { transfer });
/** @param {MessageEvent<import("./contracts.ts").WorkerRequest>} event */
self.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    controller?.abort();
    return;
  }
  if (data.type === "clear") {
    controller?.abort();
    tileSource.clearHeights();
    tileSource.cache.clear();
    tileSource.bytes = 0;
    cached = null;
    return;
  }
  if (data.type !== "build") return;
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const {
      generation,
      city: cityId,
      base,
      center,
      roads,
      limit,
      bounds,
      tileURL,
      heightURL,
      mobile,
      zoom,
    } = data;
    if (data.refreshHeights) tileSource.clearHeights();
    const active = cityId ? await snapshot(cityId, base, signal) : null;
    const origin = active && cityId ? regions[cityId].center : center;
    const candidates = nearbyLandmarks(bounds, center);
    const landmarks = landmarkGeometry(
      candidates.map(profileForLandmark),
      origin,
      Math.min(SHOWCASE_VERTEX_BUDGET, Math.floor(limit * 0.35)),
    );
    const supplied = new Set(landmarks.acceptedIds);
    const replacement = landmarkCoverage(
      candidates.filter((p) => supplied.has(p.id)),
    );
    const genericLimit = limit - landmarks.position.length / 3;
    const landscape = new EnvironmentBuilder(origin, bounds, mobile);
    const outside = (f) =>
      !active ||
      !inside(
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates[0][0]
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates[0][0][0]
            : f.geometry.coordinates[0],
        regions[cityId || ""].bbox,
      );
    /** @type {Array<import("./contracts.ts").GeometryBuffers & { buildings: number, truncated: boolean }>} */
    const parts = [landmarks];
    let remaining = genericLimit;
    const loaded = await tileSource.load(
      bounds,
      tileURL,
      mobile,
      signal,
      (buildings, environment) => {
        landscape.consume(environment);
        for (const f of buildings) landscape.excludeBuilding(f);
        const part = vectorGeometry(
          buildingPolygons(buildings).filter(
            (f) => !replacement.vector(f),
          ),
          origin,
          Math.max(0, remaining),
          zoom,
        );
        remaining -= part.position.length / 3;
        parts.push(part);
      },
      heightURL,
    );
    // Snapshots supply place labels and remaining reviewed models only.
    // Ordinary buildings always come from the global service, including presets.
    const local = active ? snapshotGeometry(active.city, Math.max(0, remaining), zoom,
      () => true, supplied) : null;
    if (local) parts.push(local);
    signal.throwIfAborted();
    /** @type {import("./contracts.ts").GeometryBuffers} */
    const geometry = /** @type {import("./contracts.ts").GeometryBuffers} */ ({});
    for (const key of [
      "position",
      "normal",
      "uv",
      "color",
      "seed",
      "facade",
      "beacons",
      "boxes",
    ]) {
      geometry[key] = new Float32Array(
        parts.reduce((n, p) => n + p[key].length, 0),
      );
      let offset = 0;
      for (const p of parts) {
        geometry[key].set(p[key], offset);
        offset += p[key].length;
      }
    }
    geometry.beacons = geometry.beacons.slice(0, 4096 * 4);
    const before = geometry.boxes.length / 12;
    const resultGeometry = {
      ...geometry,
      boxes: compactVolumes(geometry.boxes, mobile ? 45000 : 90000),
      buildings: parts.reduce((n, p) => n + p.buildings, 0) + before,
      landmarks: [...landmarks.landmarks, ...(local?.landmarks || [])],
      placeLabels: (local?.placeLabels || []).filter(p => !candidates.some(m => supplied.has(m.id) &&
        (m.osm.includes(p.id) || Math.hypot(...localPoint(...p.anchor, m.anchor)) < 25))),
      landmarkVertices: landmarks.position.length / 3,
      landmarkCount: landmarks.landmarks.length,
      landmarkOmitted: landmarks.omitted,
      truncated: parts.some(p => p.truncated),
      aggregated: 0,
      tileCount: loaded.tileCount, tileLimited: loaded.tileLimited, tileCacheMiB: loaded.cacheMiB,
      tileMetrics: loaded.metrics,
      heightAttribution: loaded.attribution, heightRevision: loaded.heightRevision,
      preparedTileCount: loaded.preparedTiles.size, heightSummary: loaded.heights,
      heightPending: loaded.heightPending, heightStatus: loaded.heightStatus,
    };
    resultGeometry.aggregated = before - resultGeometry.boxes.length / 12;
    const localRoads = active
      ? active.city.roads.map((r) => ({
          ...r,
          points: r.points.map((p) => snapshotPoint(p, origin)),
        }))
      : [];
    const globalRoads = roads.filter(outside).flatMap((f, i) => {
      const lines =
        f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiLineString"
            ? f.geometry.coordinates
            : [];
      return lines.map((line, j) => ({
        id: `vector/${i}/${j}`,
        nodes: line.map(
          (p) =>
            `v/${p[0].toFixed(7)}/${p[1].toFixed(7)}/${f.properties?.layer || 0}`,
        ),
        points: line.map((p) => localPoint(...p, origin)),
        tags: {
          highway:
            { minor: "residential", street: "residential" }[
              f.properties?.class
            ] || f.properties?.class,
          ...(f.properties?.brunnel === "tunnel" ? { tunnel: "yes" } : {}),
          ...(f.properties?.oneway
            ? { oneway: String(f.properties.oneway) }
            : {}),
        },
      }));
    });
    const graph = buildGraph({
      roads: [...localRoads, ...globalRoads],
      bounds: [-6000, -6000, 6000, 6000],
    });
    // Routes use the snapshot's original metre projection; transform only their spatial points.
    const routes = active
      ? active.routes.map((r) => ({
          ...r,
          parts: r.parts.map((p) => ({
            ...p,
            a: snapshotPoint(p.a, origin),
            b: snapshotPoint(p.b, origin),
          })),
        }))
      : [];
    const surfaceKey = active ? `${cityId}/${mobile}` : null;
    const surface =
      surfaceKey === data.surfaceKey
        ? undefined
        : active
          ? await groundSurface(active.city, mobile)
          : null;
    if (signal.aborted) surface?.bitmap.close();
    signal.throwIfAborted();
    const environment = landscape.finish();
    post(
      {
        generation,
        origin,
        geometry: resultGeometry,
        graph: packGraph(graph),
        routes,
        surface,
        surfaceKey,
        environment,
      },
      [
        ...Object.values(resultGeometry)
          .filter((v) => v instanceof Float32Array)
          .map((v) => v.buffer),
        ...(surface ? [surface.bitmap] : []),
        environment.water.buffer,
        environment.green.buffer,
        environment.bridges.buffer,
        environment.lamps.buffer,
        environment.trees.buffer,
        environment.light,
      ],
    );
  } catch (error) {
    const cancelled = signal.aborted;
    controller.abort();
    post({
      generation: data.generation,
      cancelled,
      error: error instanceof Error ? (import.meta.env.DEV ? error.stack || error.message : error.message) : String(error),
    });
  }
};
