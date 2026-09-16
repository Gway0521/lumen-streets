import { localPoint, snapshotPoint } from "./geo.js";
import { inside } from "../city.js";

// Tiles group unrelated footprints with identical properties into MultiPolygons.
// Ownership and snapshot coverage must therefore be decided per footprint.
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

function nearRing(p, ring, tolerance = 2) {
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

function boundarySamples(ring) {
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]];
  });
}

/** Some tiles contain both a building way and a slightly different relation
 * outline. Keep the taller shell when their footprints and vertical ranges
 * describe the same body. Small rooftop parts and broad podiums remain intact. */
export function uniqueBuildingShells(features) {
  if (!features.length) return [];
  const origin = footprintCenter(features[0]),
    grid = new Map(),
    result = [],
    cell = 128;
  const ordered = [...features].sort(
    (a, b) =>
      (Number(b.properties.render_height) || 8) -
      (Number(a.properties.render_height) || 8),
  );
  for (const f of ordered) {
    const rings = f.geometry.coordinates.map((r) =>
      r.map((p) => localPoint(...p, origin)),
    );
    const ring = rings[0],
      xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    const box = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    const keys = [];
    for (
      let x = Math.floor((box[0] - 2) / cell);
      x <= Math.floor((box[2] + 2) / cell);
      x++
    )
      for (
        let y = Math.floor((box[1] - 2) / cell);
        y <= Math.floor((box[3] + 2) / cell);
        y++
      )
        keys.push(`${x}/${y}`);
    const candidates = new Set(keys.flatMap((k) => grid.get(k) || []));
    const top = Number(f.properties.render_height) || 8,
      bottom = Number(f.properties.render_min_height) || 0;
    const samples = boundarySamples(ring);
    const duplicate = [...candidates].some((c) => {
      if (
        rings.length !== c.rings.length ||
        Math.abs(bottom - c.bottom) > 2 ||
        top / c.top < 0.7
      )
        return false;
      if (
        box[2] < c.box[0] ||
        box[0] > c.box[2] ||
        box[3] < c.box[1] ||
        box[1] > c.box[3]
      )
        return false;
      const match = (a, b) =>
        a.filter((p) => nearRing(p, b)).length / a.length >= 0.9;
      return (
        match(samples, c.rings[0]) &&
        match(c.samples, ring) &&
        rings
          .slice(1)
          .every((h) =>
            c.rings
              .slice(1)
              .some(
                (other) =>
                  match(boundarySamples(h), other) &&
                  match(boundarySamples(other), h),
              ),
          )
      );
    });
    if (duplicate) continue;
    result.push(f);
    const item = { rings, samples, box, top, bottom };
    for (const key of keys) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(item);
    }
  }
  return result;
}

/** Match actual snapshot footprints, including members extending beyond its query
 * bounds. An empty part of a snapshot's rectangle must not erase live buildings. */
export function snapshotCoverage(city) {
  if (!city) return () => false;
  const grid = new Map(),
    cell = 128;
  for (const f of city.buildings) {
    const ring = f.points.map((p) => snapshotPoint(p, city.center));
    if (ring.length < 3) continue;
    const holes = (f.holes || []).map((r) =>
      r.map((p) => snapshotPoint(p, city.center)),
    );
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    const box = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    const item = { ring, holes, box };
    for (let x = Math.floor(box[0] / cell); x <= Math.floor(box[2] / cell); x++)
      for (
        let y = Math.floor(box[1] / cell);
        y <= Math.floor(box[3] / cell);
        y++
      ) {
        const key = `${x}/${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(item);
      }
  }
  return (feature) => {
    const point = localPoint(...footprintCenter(feature), city.center);
    const candidates =
      grid.get(
        `${Math.floor(point[0] / cell)}/${Math.floor(point[1] / cell)}`,
      ) || [];
    if (!candidates.length) return false;
    const ring = feature.geometry.coordinates[0].map((p) =>
      localPoint(...p, city.center),
    );
    if (
      candidates.some((f) => {
        if (!inside(point, f.ring) || f.holes.some((h) => inside(point, h)))
          return false;
        // A buffered edge tolerates tile quantization without swallowing a neighbour.
        const contained = (p) =>
          inside(p, f.ring) ||
          f.ring.some((a, i) => {
            const b = f.ring[(i + 1) % f.ring.length],
              dx = b[0] - a[0],
              dy = b[1] - a[1];
            const t = Math.max(
              0,
              Math.min(
                1,
                ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                  (dx * dx + dy * dy || 1),
              ),
            );
            return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 2;
          });
        return ring.filter(contained).length / ring.length >= 0.8;
      })
    )
      return true;
    // A tile's single outline can cover several snapshot building parts.
    // Check the union rather than requiring one part to contain the whole shell.
    const contains = (p) =>
      candidates.some(
        (f) => nearRing(p, f.ring) && !f.holes.some((h) => inside(p, h)),
      );
    if (!contains(point)) return false;
    const samples = boundarySamples(ring);
    // Interior samples prevent an outline spanning a courtyard or an empty gap
    // from being mistaken for the union of neighbouring buildings.
    for (const p of ring)
      for (const t of [0.25, 0.5, 0.75])
        samples.push([
          point[0] + (p[0] - point[0]) * t,
          point[1] + (p[1] - point[1]) * t,
        ]);
    return samples.every(contains);
  };
}
