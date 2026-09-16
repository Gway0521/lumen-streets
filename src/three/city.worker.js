import { parseCity, regions } from "../city.js";
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
import { buildingPolygons, snapshotCoverage } from "./building-source.js";
import { pointTile } from "./height-tiles.js";

let cached = null;
const tileSource = new BuildingTiles();
let controller;
const inside = (p, b) =>
  p[0] >= b[1] && p[0] <= b[3] && p[1] >= b[0] && p[1] <= b[2];
async function snapshot(id, base) {
  if (cached?.id === id) return cached;
  const r = await fetch(`${base}data/${id}.json`);
  if (!r.ok) throw Error("Snapshot unavailable");
  const city = parseCity(await r.json(), id);
  let routes = [];
  const rail = await fetch(`${base}data/${id}-rail.json`);
  if (rail.ok)
    routes = buildRailRoutes(
      parseRail(await rail.json(), city.center),
      city.bounds,
    );
  cached = { id, city, routes };
  return cached;
}
self.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    controller?.abort();
    return;
  }
  if (data.type === "clear") {
    controller?.abort();
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
    const active = cityId ? await snapshot(cityId, base) : null;
    const origin = active ? regions[cityId].center : center;
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
    const covered = snapshotCoverage(active?.city);
    const outside = (f) =>
      !active ||
      !inside(
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates[0][0]
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates[0][0][0]
            : f.geometry.coordinates[0],
        regions[cityId].bbox,
      );
    await tileSource.configure(tileURL, heightURL, signal);
    const enriching = tileSource.hasPreparedCoverage(bounds, mobile);
    const localBudget = active ? Math.floor(genericLimit * 0.55) : 0;
    let local = active && !enriching ? snapshotGeometry(active.city, localBudget, zoom,
      (f) => replacement.snapshot(f, origin), supplied) : null;
    // Preserve the existing allocation/order outside prepared coverage. Inside,
    // defer local geometry until streamed tile ownership is known.
    const parts = local ? [landmarks, local] : [landmarks];
    let remaining = genericLimit - (local ? local.position.length / 3 : localBudget);
    const loaded = await tileSource.load(
      bounds,
      tileURL,
      mobile,
      signal,
      (buildings, environment, { prepared }) => {
        landscape.consume(environment);
        for (const f of buildings) landscape.excludeBuilding(f);
        const part = vectorGeometry(
          buildingPolygons(buildings).filter(
            (f) => (prepared || !covered(f)) && !replacement.vector(f),
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
    const coveredByPrepared = (f) => {
      // Same source-grid ownership for snapshots and prepared coverage. The
      // snapshot remains immutable for saved legacy scenes and traffic.
      const xs = f.points.map(p => p[0]), ys = f.points.map(p => p[1]);
      const px = (Math.min(...xs) + Math.max(...xs)) / 2,
        py = (Math.min(...ys) + Math.max(...ys)) / 2;
      const point = [origin[0] + px / (111320 * Math.cos(origin[1] * Math.PI / 180)),
        origin[1] - py / 111320];
      return loaded.preparedTiles.has(pointTile(point));
    };
    if (active && enriching) {
      local = snapshotGeometry(active.city, localBudget + Math.max(0, remaining), zoom,
        (f) => replacement.snapshot(f, origin) || coveredByPrepared(f), supplied);
      parts.push(local);
    }
    signal.throwIfAborted();
    const geometry = {};
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
    geometry.buildings = parts.reduce((n, p) => n + p.buildings, 0);
    geometry.beacons = geometry.beacons.slice(0, 4096 * 4);
    geometry.landmarks = [...landmarks.landmarks, ...(local?.landmarks || [])];
    geometry.placeLabels = (local?.placeLabels || []).filter(
      (p) =>
        !candidates.some(
          (m) =>
            supplied.has(m.id) &&
            (m.osm.includes(p.id) ||
              Math.hypot(...localPoint(...p.anchor, m.anchor)) < 25),
        ),
    );
    geometry.landmarkVertices = landmarks.position.length / 3;
    geometry.landmarkCount = landmarks.landmarks.length;
    geometry.landmarkOmitted = landmarks.omitted;
    geometry.truncated = parts.some((p) => p.truncated);
    geometry.buildings += geometry.boxes.length / 12;
    const before = geometry.boxes.length / 12;
    geometry.boxes = compactVolumes(geometry.boxes, mobile ? 45000 : 90000);
    geometry.aggregated = before - geometry.boxes.length / 12;
    geometry.tileCount = loaded.tileCount;
    geometry.tileLimited = loaded.tileLimited;
    geometry.tileCacheMiB = loaded.cacheMiB;
    geometry.heightAttribution = loaded.attribution;
    geometry.heightRevision = loaded.heightRevision;
    geometry.preparedTileCount = loaded.preparedTiles.size;
    geometry.heightSummary = loaded.heights;
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
    self.postMessage(
      {
        generation,
        origin,
        geometry,
        graph: packGraph(graph),
        routes,
        surface,
        surfaceKey,
        environment,
      },
      [
        ...Object.values(geometry)
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
    self.postMessage({
      generation: data.generation,
      cancelled,
      error: import.meta.env.DEV ? error.stack : error.message,
    });
  }
};
