import { random } from "./random.js";
import { buildingArea, buildingCenter } from "../lighting.js";
import { resolveHeight, featureSeed } from "../buildings/heights.js";
import { LEGACY_DIRECTION } from "../engine/projection.js";
// Fixed art projection; no per-building compression of source measurements.
export const ROOF_DIRECTION = LEGACY_DIRECTION;
const signedArea = ring => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

export function buildingProfile(feature, activity = .5, elevation, upperPoints = feature.points, direction = ROOF_DIRECTION) {
  const area = Math.max(1, buildingArea(feature.points) - (feature.holes || []).reduce((sum, ring) => sum + buildingArea(ring), 0));
  const r = random(featureSeed(feature)), center = buildingCenter(feature.points);
  const resolved = elevation || resolveHeight(feature, area, r());
  const height = resolved.top - resolved.bottom;
  const offset = direction.map(v => v * height);
  const base = p => p.map((v, i) => v + direction[i] * resolved.bottom);
  const project = p => [p[0] + offset[0], p[1] + offset[1]];
  const roof = upperPoints.map(p => project(base(p))), holes = (feature.holes || []).map(ring => ring.map(p => project(base(p))));
  const faces = [];
  for (const [index, ring] of [feature.points, ...(feature.holes || [])].entries()) {
    const orientation = Math.sign(signedArea(ring)) * (index ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = base(ring[i]), b = base(ring[(i + 1) % ring.length]);
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const facing = orientation * (dy * offset[0] - dx * offset[1]) / length;
      if (facing >= -.01) continue;
      const upperA = index ? project(a) : roof[i], upperB = index ? project(b) : roof[(i + 1) % ring.length];
      faces.push({ a, b, length, points: [a, b, upperB, upperA], exposure: -facing / Math.hypot(...offset) });
    }
  }
  return { feature, area, center, height, elevation: resolved, offset, roof, holes, faces, direction,
    depth: center[0] * -direction[0] + center[1] * -direction[1] };
}
