// Shared browser/server interpretation of Overture attributes. A render default
// is never written into a source height. Python enrichment uses the same tiers.
export const GLOBAL_RELEASE = "2026-08-19.0";
export const RESOLVER_VERSION = "global-2";
export const OVERTURE_CREDIT =
  "Overture Maps Foundation; OpenStreetMap contributors";
const classes = {
  house: 6,
  detached: 6,
  semidetached_house: 6,
  terrace: 9,
  apartments: 18,
  residential: 9,
  commercial: 12,
  office: 15,
  retail: 6,
  industrial: 9,
  warehouse: 9,
  garage: 4,
  garages: 4,
  shed: 4,
  roof: 4,
  school: 9,
  hospital: 15,
  hotel: 15,
};
export function numeric(value, maximum = 1200, zero = false) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    value === ""
  )
    return null;
  if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(value))
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n <= maximum && (zero ? n >= 0 : n > 0)
    ? n
    : null;
}
export function jsonAttribute(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  if (value.length > 64000) throw Error("Building attribute exceeds budget");
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function footprintArea(geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;
  for (const rings of polygons)
    for (const [j, ring] of rings.entries()) {
      const lat = (ring[0][1] * Math.PI) / 180,
        sx = 111320 * Math.cos(lat),
        sy = 111320;
      let a = 0;
      const [ox, oy] = ring[0];
      for (let i = 0; i < ring.length - 1; i++)
        a +=
          (ring[i][0] - ox) * (ring[i + 1][1] - oy) -
          (ring[i + 1][0] - ox) * (ring[i][1] - oy);
      area += ((j ? -1 : 1) * Math.abs(a * sx * sy)) / 2;
    }
  return Math.max(0, area);
}
export function fallbackHeight(kind, area) {
  return classes[kind] ?? Math.max(4, Math.min(24, Math.sqrt(area) * 0.8));
}
export function globalHeight(feature) {
  const p = feature.properties || {},
    raw = numeric(p.height),
    floors = numeric(p.num_floors, 250);
  const sources = jsonAttribute(p.sources, []);
  if (!Array.isArray(sources) || sources.length > 100)
    throw Error("Invalid building provenance");
  const scoped = sources.filter((s) =>
    ["", "/height", "height", "properties/height"].includes(s?.property),
  );
  const names = scoped
    .map((s) => s.dataset)
    .join(" ")
    .toLowerCase();
  const mapped =
    /openstreetmap|\bosm\b/.test(names) &&
    !/microsoft|google|\bml\b/.test(names);
  let bottom =
    numeric(p.min_height, 1200, true) ?? (numeric(p.min_floor, 250) || 0) * 3.2;
  const floorHeight = floors
    ? floors * 3.2 + (numeric(p.roof_height) || 0)
    : null;
  let value, method;
  if (raw && raw > bottom && mapped) {
    value = raw;
    method = "mapped";
  } else if (floorHeight && floorHeight > bottom && floorHeight <= 1200) {
    value = floorHeight;
    method = "levels";
  } else if (raw && raw > bottom) {
    value = raw;
    method = "model";
  } else {
    value = fallbackHeight(
      p.class || p.subtype || "yes",
      footprintArea(feature.geometry),
    );
    method = "fallback";
    bottom = 0;
  }
  return {
    lumen_height_version: 1,
    source_id: feature.id,
    building: p.class || p.subtype || "yes",
    height_raw: p.height ?? null,
    floors_raw: p.num_floors ?? null,
    height_missing: raw === null,
    height_m: value,
    min_height_m: bottom,
    height_source: method === "fallback" ? "lumen-fallback" : "overture",
    height_source_id: feature.id,
    height_method: method,
    height_definition:
      method === "mapped"
        ? "ground_to_top"
        : method === "levels"
          ? "ground_to_roof"
          : method === "model" && /microsoft|google|\bml\b/.test(names)
            ? "roof_mean"
            : "roof_unspecified",
    height_year: null,
    height_match: 1,
    height_estimated: method !== "mapped",
    height_conflict: false,
    "building:part": p.type === "building_part" ? "yes" : null,
    parent_id: p.building_id || null,
    class: p.class ?? null,
    subtype: p.subtype ?? null,
  };
}
