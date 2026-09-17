import { inside } from "../shared/geometry.js";

// Tiles group unrelated footprints with identical properties into MultiPolygons.
// Split them before landmark replacement and facade generation.
export function buildingPolygons(features) {
  return features.flatMap((feature) => {
    const hidden = feature.properties?.hide_3d;
    if (hidden === true || hidden === 1 || hidden === "true" || hidden === "1")
      return [];
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.type === "MultiPolygon"
          ? feature.geometry.coordinates
          : [];
    return polygons
      .filter((p) => p[0]?.length >= 4)
      .map((coordinates) => ({
        ...feature,
        geometry: { type: "Polygon", coordinates },
      }));
  });
}

export function footprintCenter(feature) {
  const ring = feature.geometry.coordinates[0];
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const [x, y] of ring) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return [(west + east) / 2, (south + north) / 2];
}

export function nearRing(p, ring, tolerance = 2) {
  return (
    inside(p, ring) ||
    ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      return (
        Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= tolerance
      );
    })
  );
}
