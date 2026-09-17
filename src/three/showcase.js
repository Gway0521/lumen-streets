import catalog from "./showcase-landmarks.json" with { type: "json" };
import { LANDMARK_PACK } from "../buildings/catalog.js";
import { showcaseProfile } from "./showcase-shapes.js";
import { localPoint } from "./geo.js";
import { inside } from "../shared/geometry.js";
import { nearRing, footprintCenter } from "./building-source.js";

export const showcaseLandmarks = catalog.landmarks;
export const SHOWCASE_VERTEX_BUDGET = 90000;

export function nearbyLandmarks(bounds, center) {
  return showcaseLandmarks
    .filter((p) => {
      // Include structures just beyond the ground viewport whose upper floors can be visible.
      const margin = (p.height * 1.6 + Math.max(p.width, p.depth)) / 111320;
      return (
        p.anchor[0] >=
          bounds[0] - margin / Math.cos((p.anchor[1] * Math.PI) / 180) &&
        p.anchor[0] <=
          bounds[2] + margin / Math.cos((p.anchor[1] * Math.PI) / 180) &&
        p.anchor[1] >= bounds[1] - margin &&
        p.anchor[1] <= bounds[3] + margin
      );
    })
    .sort(
      (a, b) =>
        Math.hypot(...localPoint(...a.anchor, center)) -
        Math.hypot(...localPoint(...b.anchor, center)),
    );
}

export function profileForLandmark(record) {
  return record.legacyProfile
    ? {
        ...record,
        ...LANDMARK_PACK.profiles.find((p) => p.id === record.legacyProfile),
      }
    : showcaseProfile(record);
}

/** Ownership is tied to reviewed OSM polygons, never a circular deletion zone.
 * The index is small (only models that actually fit the active geometry budget).
 * Mid-edge samples reject neighbouring shells spanning a courtyard or gap. */
export function landmarkCoverage(records) {
  const sources = new Set(records.flatMap((p) => p.osm));
  const regions = records.flatMap((p) =>
    p.footprints.map((ring) => {
      const xs = ring.map((v) => v[0]),
        ys = ring.map((v) => v[1]);
      return {
        origin: p.anchor,
        ring: ring.map((v) => localPoint(...v, p.anchor)),
        holes: (p.holes || []).map((r) =>
          r.map((v) => localPoint(...v, p.anchor)),
        ),
        bounds: [
          Math.min(...xs) - 0.00003,
          Math.min(...ys) - 0.00003,
          Math.max(...xs) + 0.00003,
          Math.max(...ys) + 0.00003,
        ],
      };
    }),
  );
  const vector = (f) => {
    const center = footprintCenter(f);
    return regions.some((r) => {
      const b = r.bounds;
      if (
        center[0] < b[0] ||
        center[0] > b[2] ||
        center[1] < b[1] ||
        center[1] > b[3]
      )
        return false;
      const points = f.geometry.coordinates[0].map((p) =>
        localPoint(...p, r.origin),
      );
      const contained = (p) =>
        nearRing(p, r.ring) && !r.holes.some((h) => inside(p, h));
      // A courtyard or concave outline can have its bounding-box centre outside
      // the building. Its own boundary still belongs to the reviewed source.
      if (!contained(localPoint(...center, r.origin)))
        return (
          points.every((p) => nearRing(p, r.ring)) &&
          r.ring.every((p) => nearRing(p, points))
        );
      return points.every((p, i) => {
        const next = points[(i + 1) % points.length];
        return (
          contained(p) &&
          contained([(p[0] + next[0]) / 2, (p[1] + next[1]) / 2])
        );
      });
    });
  };
  const snapshot = (f, center) =>
    sources.has(f.sourceId) ||
    vector({
      geometry: {
        type: "Polygon",
        coordinates: [
          f.points.map(([x, y]) => [
            center[0] + x / (111320 * Math.cos((center[1] * Math.PI) / 180)),
            center[1] - y / 111320,
          ]),
        ],
      },
    });
  return { vector, snapshot };
}
