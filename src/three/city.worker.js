import { parseCity, regions } from "../city.js";
import { snapshotGeometry, vectorGeometry } from "./geometry.js";
import { buildGraph } from "../traffic.js";
import { parseRail, buildRailRoutes } from "../rail.js";
import { localPoint, snapshotPoint } from "./geo.js";
import { packGraph } from "./graph-wire.js";

let cached = null;
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
  if (data.type !== "build") return;
  try {
    const {
      generation,
      city: cityId,
      base,
      center,
      buildings,
      roads,
      limit,
    } = data;
    const active = cityId ? await snapshot(cityId, base) : null;
    const origin = active ? regions[cityId].center : center;
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
    const local = active ? snapshotGeometry(active.city, limit) : null;
    const world = vectorGeometry(
      buildings.filter(outside),
      origin,
      Math.max(0, limit - (local?.position.length || 0) / 3),
    );
    const geometry = {};
    for (const key of ["position", "normal", "uv", "color", "seed"]) {
      geometry[key] = new Float32Array(
        (local?.[key].length || 0) + world[key].length,
      );
      if (local) geometry[key].set(local[key]);
      geometry[key].set(world[key], local?.[key].length || 0);
    }
    geometry.buildings = (local?.buildings || 0) + world.buildings;
    geometry.landmarks = local?.landmarks || [];
    geometry.truncated = !!(local?.truncated || world.truncated);
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
    self.postMessage(
      { generation, origin, geometry, graph: packGraph(graph), routes },
      Object.values(geometry)
        .filter((v) => v instanceof Float32Array)
        .map((v) => v.buffer),
    );
  } catch (error) {
    self.postMessage({
      generation: data.generation,
      error: import.meta.env.DEV ? error.stack : error.message,
    });
  }
};
