import { MapRequestError } from "./area.js";

// Eight reference maps: 3,264–18,831 elements, 23,652–112,255 vertices.
// These limits also bound graph construction and multipolygon assembly before rendering.
export function validateMap(raw, optionalRail = false) {
  if (raw?.remark) throw new MapRequestError("partialData", 502);
  if (!Array.isArray(raw?.elements)) throw new MapRequestError("badData", 502);
  if (raw.elements.length > 30000) throw new MapRequestError("tooDense", 413);
  let points = 0;
  let stations = 0;
  const geometry = (list) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) throw new MapRequestError("badData", 502);
    points += list.length;
    if (points > (optionalRail ? 25000 : 180000) || list.length > 12000) throw new MapRequestError("tooDense", 413);
    for (const p of list) if (!p || !Number.isFinite(p.lon) || !Number.isFinite(p.lat) ||
      Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90) throw new MapRequestError("badData", 502);
  };
  for (const e of raw.elements) {
    if (!e || !["way", "node", "relation"].includes(e.type) || !Number.isSafeInteger(e.id) || e.id <= 0)
      throw new MapRequestError("badData", 502);
    if (e.tags && (typeof e.tags !== "object" || Array.isArray(e.tags) ||
      Object.entries(e.tags).some(([k, v]) => k.length > 255 || typeof v !== "string" || v.length > 2048)))
      throw new MapRequestError("badData", 502);
    geometry(e.geometry);
    if (e.type === "way" && (!Array.isArray(e.geometry) || e.geometry.length < 2))
      throw new MapRequestError("partialData", 502);
    if (e.nodes && (!Array.isArray(e.nodes) || e.nodes.length > 12000 || !e.nodes.every(Number.isSafeInteger)))
      throw new MapRequestError("badData", 502);
    if (e.type === "node") {
      geometry([{ lat: e.lat, lon: e.lon }]);
      if (optionalRail && ++stations > 256) throw new MapRequestError("tooDense", 413);
    }
    if (e.members !== undefined) {
      if (!Array.isArray(e.members)) throw new MapRequestError("badData", 502);
      if (e.members.length > 256) throw new MapRequestError("tooDense", 413);
      for (const m of e.members) {
        if (!m || typeof m.role !== "string" || !Number.isSafeInteger(m.ref)) throw new MapRequestError("badData", 502);
        geometry(m.geometry);
      }
    }
  }
  if (!optionalRail && !raw.elements.some(e => e.type === "way" && e.geometry?.length > 1 && (e.tags?.building || e.tags?.highway)))
    throw new MapRequestError("emptyArea", 422);
  return raw;
}
