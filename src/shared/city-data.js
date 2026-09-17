import { regions } from "./regions.js";
import { project, inside, assembleRings } from "./geometry.js";
import { buildingAssemblies, isStructure } from "../buildings/assemblies.js";
export function parseCity(raw, id, region = regions[id]) {
  if (!region) throw new Error("Unknown region");
  const relationFeatures = [],
    memberIds = new Set();
  for (const e of raw.elements.filter(
    (e) => e.type === "relation" && e.members && e.tags?.type !== "building",
  )) {
    const outers = assembleRings(
        e.members.filter((m) => m.role === "outer" || m.role === ""),
      ),
      inners = assembleRings(e.members.filter((m) => m.role === "inner"));
    if (!outers.length) continue;
    const holes = inners.map((r) => r.map((p) => project(...p, region.center)));
    for (let i = 0; i < outers.length; i++) {
      const points = outers[i].map((p) => project(...p, region.center));
      relationFeatures.push({
        id: e.id + i * 0.01,
        sourceId: `relation/${e.id}/outer/${i}`,
        tags: e.tags || {},
        points,
        holes: holes.filter((h) => inside(h[0], points)),
      });
    }
    for (const m of e.members) if (m.type === "way" && ["outer", "inner", ""].includes(m.role)) memberIds.add(m.ref);
  }
  const features = raw.elements
    .filter(
      (e) =>
        e.type === "way" &&
        e.geometry?.length > 1 &&
        (!memberIds.has(e.id) || e.tags?.highway || (e.tags?.['building:part'] && e.tags['building:part'] !== 'no')),
    )
    .map((e) => ({
      id: e.id,
      sourceId: `way/${e.id}`,
      tags: e.tags || {},
      nodes: e.nodes,
      points: e.geometry
        .filter((p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))
        .map((p) => project(p.lon, p.lat, region.center)),
      holes: [],
    }))
    .filter((e) => e.points.length > 1);
  features.push(...relationFeatures);
  for (const e of raw.elements.filter(e => e.type === "node" && ["tower", "mast"].includes(e.tags?.man_made))) {
    if (!Number.isFinite(e.lon) || !Number.isFinite(e.lat)) continue;
    const p = project(e.lon, e.lat, region.center);
    features.push({ id: e.id, sourceId: `node/${e.id}`, tags: e.tags, holes: [],
      points: [[-3,-3],[3,-3],[3,3],[-3,3],[-3,-3]].map(v => [p[0]+v[0],p[1]+v[1]]) });
  }
  const bbox = raw.pocketPlaces.bbox,
    a = project(bbox[1], bbox[2], region.center),
    b = project(bbox[3], bbox[0], region.center);
  return {
    id,
    ...region,
    bounds: [a[0], a[1], b[0], b[1]],
    features,
    buildings: buildingAssemblies(features, raw.elements.filter(e => e.type === "relation")),
    roads: features.filter((f) => f.tags.highway),
    land: features.filter(
      (f) => !isStructure(f) && !f.tags.highway && f.points.length > 3,
    ),
    source: raw.pocketPlaces,
  };
}
