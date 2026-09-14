import earcut from "earcut";
import { featureSeed, resolveHeight, metres } from "../buildings/heights.js";
import { buildingArea, districtField, buildingCenter } from "../lighting.js";
import { inside } from "../city.js";
import { generateComponents } from "../buildings/components.js";
import { generateStructure, genericTower } from "../buildings/generators.js";
import { resolveRenderPlan } from "../buildings/plan.js";
import { LANDMARK_PACK } from "../buildings/catalog.js";
import { snapshotPoint, localPoint } from "./geo.js";

const colors = {
  glass: [0.11, 0.18, 0.22],
  jade: [0.1, 0.25, 0.23],
  cornice: [0.32, 0.35, 0.29],
  stone: [0.19, 0.21, 0.22],
  silver: [0.23, 0.29, 0.32],
  rose: [0.37, 0.19, 0.28],
  ivory: [0.66, 0.59, 0.4],
  steel: [0.38, 0.23, 0.14],
  iron: [0.24, 0.22, 0.2],
  observatory: [0.3, 0.33, 0.3],
  "green-roof": [0.15, 0.31, 0.23],
  clock: [0.55, 0.43, 0.27],
};
const clean = (ring) =>
  ring.length > 1 &&
  ring[0][0] === ring.at(-1)[0] &&
  ring[0][1] === ring.at(-1)[1]
    ? ring.slice(0, -1)
    : ring;
export class MeshBuilder {
  constructor(limit = 650000) {
    this.limit = limit;
    this.position = [];
    this.normal = [];
    this.uv = [];
    this.color = [];
    this.seed = [];
    this.buildings = 0;
    this.truncated = false;
  }
  triangle(a, b, c, uvs, material, seed) {
    if (this.position.length / 3 + 3 > this.limit) {
      this.truncated = true;
      return;
    }
    const u = b.map((n, i) => n - a[i]),
      v = c.map((n, i) => n - a[i]);
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      length = Math.hypot(...n);
    if (length < 1e-7) return;
    n = n.map((x) => x / length);
    const color = colors[material] || [
      0.115 + (seed % 7) * 0.006,
      0.17 + (seed % 5) * 0.006,
      0.205 + (seed % 3) * 0.008,
    ];
    [a, b, c].forEach((p, i) => {
      this.position.push(...p);
      this.normal.push(...n);
      this.uv.push(...(uvs?.[i] || [p[0], p[2]]));
      this.color.push(...color);
      this.seed.push(seed % 10000);
    });
  }
  solid(rings, bottom, top, seed, material, upper = null, roof = null) {
    rings = rings.map(clean).filter((r) => r.length >= 3);
    if (!rings.length) return;
    const required = rings.reduce((sum, r) => sum + r.length * 18, 0);
    if (this.position.length / 3 + required > this.limit) {
      this.truncated = true;
      return;
    }
    const vertices = rings.flat(),
      holes = [];
    let count = rings[0].length;
    for (const r of rings.slice(1)) {
      holes.push(count);
      count += r.length;
    }
    const upperRing = upper ? clean(upper) : null;
    for (const [j, ring] of rings.entries()) {
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ua = j === 0 && upperRing ? upperRing[i] : a,
          ub = j === 0 && upperRing ? upperRing[(i + 1) % ring.length] : b;
        const za = roof ? roof(ua) : top,
          zb = roof ? roof(ub) : top;
        const p = [...a, bottom],
          q = [...b, bottom],
          r = [...ub, zb],
          s = [...ua, za];
        this.triangle(
          p,
          q,
          r,
          [
            [u, bottom],
            [u + length, bottom],
            [u + length, zb],
          ],
          material,
          seed,
        );
        this.triangle(
          p,
          r,
          s,
          [
            [u, bottom],
            [u + length, zb],
            [u, za],
          ],
          material,
          seed,
        );
        u += length;
      }
    }
    const roofVertices = upperRing && rings.length === 1 ? upperRing : vertices;
    const indices = earcut(roofVertices.flat(), holes, 2);
    for (let i = 0; i < indices.length; i += 3)
      this.triangle(
        ...indices
          .slice(i, i + 3)
          .map((k) => [...roofVertices[k], roof ? roof(roofVertices[k]) : top]),
        null,
        material,
        seed,
      );
    this.buildings++;
  }
  finish() {
    const data = {};
    for (const key of ["position", "normal", "uv", "color", "seed"])
      data[key] = new Float32Array(this[key]);
    return { ...data, buildings: this.buildings, truncated: this.truncated };
  }
}
function model(builder, feature, anchor, profile, convert) {
  const seed = featureSeed(feature);
  if (profile.generator === "components") {
    for (const t of generateComponents(feature, anchor, profile))
      builder.triangle(
        ...t.vertices.map(([x, y, z]) => [...convert([x, y]), z]),
        null,
        t.material,
        seed,
      );
  } else {
    const shape = generateStructure(feature, anchor, profile, [0, 0]);
    for (const b of shape.profiles)
      builder.solid(
        [b.feature.points, ...b.feature.holes].map((r) => r.map(convert)),
        b.elevation.bottom,
        b.elevation.top,
        seed,
        b.material,
        b.roof.map(convert),
      );
    for (const rod of shape.rods) {
      // Reuse the component beam generator so lattice openings remain true geometry.
      for (const t of generateComponents(feature, [0, 0], {
        art: { rotation: 0 },
        components: [
          {
            kind: "beam",
            a: rod.a,
            b: rod.b,
            radius: rod.width / 2,
            material: rod.material,
          },
        ],
      }))
        builder.triangle(
          ...t.vertices.map(([x, y, z]) => [...convert([x, y]), z]),
          null,
          t.material,
          seed,
        );
    }
  }
}
function ordinary(builder, f, convert) {
  if (f.points.length > 2048 || buildingArea(f.points) < 8) return;
  const seed = featureSeed(f),
    h = resolveHeight(f, buildingArea(f.points), (seed % 1000) / 1000),
    rings = [f.points, ...(f.holes || [])].map((r) => r.map(convert));
  // A rectangular gable is split at its ridge before triangulation; arbitrary complex
  // roofs remain flat until a supported roof generator exists.
  const ring = clean(rings[0]),
    shape = f.tags["roof:shape"],
    roofHeight = metres(f.tags["roof:height"]) ?? 3;
  if (
    shape === "gabled" &&
    ring.length === 4 &&
    rings.length === 1 &&
    roofHeight < h.top - h.bottom
  ) {
    const [a, b, c, d] = ring,
      ab = Math.hypot(a[0] - b[0], a[1] - b[1]),
      bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const r = ab >= bc ? [a, b, c, d] : [b, c, d, a],
      mid = (a, b) => a.map((x, i) => (x + b[i]) / 2),
      u = mid(r[0], r[3]),
      v = mid(r[1], r[2]),
      e = h.top - roofHeight;
    builder.solid(rings, h.bottom, e, seed);
    const p = r.map((x) => [...x, e]),
      q = [...u, h.top],
      s = [...v, h.top];
    builder.triangle(p[0], p[1], s, null, null, seed);
    builder.triangle(p[0], s, q, null, null, seed);
    builder.triangle(q, s, p[2], null, null, seed);
    builder.triangle(q, p[2], p[3], null, null, seed);
    builder.triangle(p[0], q, p[3], null, null, seed);
    builder.triangle(p[1], p[2], s, null, null, seed);
  } else {
    builder.solid(rings, h.bottom, h.top, seed);
    if (
      h.top > 8 &&
      buildingArea(ring) > 180 &&
      rings[0].length < 150 &&
      !builder.truncated
    ) {
      const center = buildingCenter(ring),
        count = builder.buildings;
      for (let i = 0; i < 3; i++) {
        const x = center[0] + ((seed >> (i * 3)) % 15) - 7,
          y = center[1] + ((seed >> (i * 4)) % 13) - 6,
          w = 2 + ((seed + i) % 3);
        const box = [
          [x - w, y - 1.5],
          [x + w, y - 1.5],
          [x + w, y + 1.5],
          [x - w, y + 1.5],
        ];
        if (
          box.every(
            (p) =>
              inside(p, ring) &&
              !rings.slice(1).some((hole) => inside(p, hole)),
          )
        )
          builder.solid([box], h.top, h.top + 1.4, seed, "silver");
      }
      builder.buildings = count;
    }
  }
}
export function snapshotGeometry(city, limit) {
  const builder = new MeshBuilder(limit),
    convert = (p) => snapshotPoint(p, city.center),
    plan = resolveRenderPlan(city, LANDMARK_PACK.profiles),
    activity = districtField(city);
  for (const m of plan.models)
    model(builder, m.feature, m.anchor, m.profile, convert);
  for (const { feature, kind } of plan.normal) {
    if (builder.truncated) break;
    if (kind === "frame") {
      const m = genericTower(feature);
      model(builder, feature, m.anchor, m.profile, convert);
    } else {
      const first = builder.color.length,
        brightness = 0.72 + activity(...buildingCenter(feature.points)) * 0.6;
      ordinary(builder, feature, convert);
      for (let i = first; i < builder.color.length; i++)
        builder.color[i] *= brightness;
    }
  }
  return {
    ...builder.finish(),
    landmarks: plan.models.map((m) => ({
      id: m.profile.id,
      anchor: m.profile.anchor,
      height: m.profile.height,
    })),
  };
}
export function vectorGeometry(features, center, limit) {
  const builder = new MeshBuilder(limit);
  for (const f of features) {
    if (builder.truncated) break;
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    for (const [i, rings] of polygons.entries()) {
      if (!rings.length) continue;
      const h = Number(f.properties?.render_height),
        min = Number(f.properties?.render_min_height);
      const projected = rings.map((r) =>
        r.map((p) => localPoint(...p, center)),
      );
      ordinary(
        builder,
        {
          sourceId: `tile/${f.id ?? features.indexOf(f)}/${i}`,
          tags: {
            building: "yes",
            ...(h > 0 ? { height: String(h) } : {}),
            ...(min > 0 ? { min_height: String(min) } : {}),
          },
          points: projected[0],
          holes: projected.slice(1),
        },
        (p) => p,
      );
    }
  }
  return builder.finish();
}
