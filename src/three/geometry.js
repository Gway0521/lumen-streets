import earcut from "earcut";
import { featureSeed, resolveHeight, metres } from "../buildings/heights.js";
import { buildingArea, districtField, buildingCenter } from "../lighting.js";
import { inside } from "../city.js";
import { generateComponents } from "../buildings/components.js";
import { generateStructure, genericTower } from "../buildings/generators.js";
import { resolveRenderPlan } from "../buildings/plan.js";
import { LANDMARK_PACK } from "../buildings/catalog.js";
import { snapshotPoint, localPoint } from "./geo.js";
import {
  facadeType,
  facadeTone,
  facadeRandom,
  hasObstructionLights,
} from "./facades.js";
import { selectLandmarks, landmarkName } from "../landmarks.js";

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
    this.facade = [];
    this.beacons = [];
    this.appearance = { type: 0, bottom: 0, top: 12, tone: facadeTone(0, 0) };
    this.buildings = 0;
    this.truncated = false;
  }
  triangle(a, b, c, uvs, material, seed, face = null) {
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
    const color = colors[material] || this.appearance.tone;
    const descriptor = face || [
      this.appearance.type,
      this.appearance.bottom,
      this.appearance.top,
      0,
    ];
    const tangent = Math.hypot(n[0], n[1]);
    [a, b, c].forEach((p, i) => {
      this.position.push(...p);
      this.normal.push(...n);
      this.uv.push(
        ...(uvs?.[i] || [
          tangent > 0.01 ? (-n[1] * p[0] + n[0] * p[1]) / tangent : p[0],
          p[2],
        ]),
      );
      this.color.push(...color);
      this.seed.push(seed % 10000);
      this.facade.push(...descriptor);
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
        const face = [
          material === "silver" && top - bottom < 3 ? 7 : this.appearance.type,
          bottom,
          top,
          length,
        ];
        this.triangle(
          p,
          q,
          r,
          [
            [0, bottom],
            [length, bottom],
            [length, zb],
          ],
          material,
          seed,
          face,
        );
        this.triangle(
          p,
          r,
          s,
          [
            [0, bottom],
            [length, zb],
            [0, za],
          ],
          material,
          seed,
          face,
        );
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
    for (const key of [
      "position",
      "normal",
      "uv",
      "color",
      "seed",
      "facade",
      "beacons",
    ])
      data[key] = new Float32Array(this[key]);
    return { ...data, buildings: this.buildings, truncated: this.truncated };
  }
}
function model(builder, feature, anchor, profile, convert) {
  const seed = featureSeed(feature);
  const type =
    profile.generator === "tiered" || profile.id === "jin-mao" ? 5 : 8;
  const lighting =
    {
      "taipei-101": 4,
      "jin-mao": 1,
      "shanghai-tower": 2,
      "shanghai-wfc": 2,
      "oriental-pearl": 3,
      "sapporo-tv-tower": 1,
    }[profile.id] || 1;
  builder.appearance = {
    type,
    bottom: profile.baseElevation || 0,
    top: profile.height,
    tone: facadeTone(type, seed),
  };
  const start = builder.position.length;
  if (profile.generator === "components") {
    for (const component of profile.components) {
      const triangles = generateComponents(feature, anchor, {
        ...profile,
        components: [component],
      });
      const zs =
        component.sections?.map((s) => s[0]) ||
        (component.center
          ? [
              component.center[2] - component.radii[2],
              component.center[2] + component.radii[2],
            ]
          : [component.a[2], component.b[2]]);
      const bottom = Math.min(...zs),
        top = Math.max(...zs);
      const center = convert(anchor);
      const radius =
        component.radii?.[0] || component.sections?.[0]?.[1] / 2 || 1;
      for (const [i, t] of triangles.entries()) {
        const vertices = t.vertices.map(([x, y, z]) => [...convert([x, y]), z]);
        let uvs = null,
          width = 0;
        if (component.kind !== "beam" && component.shape !== "rectangle") {
          const angles = vertices.map((p) =>
            Math.atan2(p[1] - center[1], p[0] - center[0]),
          );
          if (Math.max(...angles) - Math.min(...angles) > Math.PI)
            for (let j = 0; j < angles.length; j++)
              if (angles[j] < 0) angles[j] += Math.PI * 2;
          uvs = vertices.map((p, j) => [angles[j] * radius, p[2]]);
        } else if (component.shape === "rectangle" && t.windows) {
          const pair = triangles[i - (i % 2)].vertices;
          width = Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
          uvs = vertices.map((p, j) => [
            (i % 2 ? [0, width, 0] : [0, width, width])[j],
            p[2],
          ]);
        }
        builder.triangle(...vertices, uvs, t.material, seed, [
          (t.windows ? type : 9) + lighting * 16,
          bottom,
          top,
          width,
        ]);
      }
    }
  } else {
    builder.appearance.type = type + lighting * 16;
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
          [
            9 + lighting * 16,
            Math.min(rod.a[2], rod.b[2]),
            Math.max(rod.a[2], rod.b[2]),
            0,
          ],
        );
    }
  }
  // Place one beacon on an actual highest vertex, including tapered spires.
  if (hasObstructionLights(profile.height, seed)) {
    let highest = -Infinity,
      site;
    for (let i = start; i < builder.position.length; i += 3)
      if (builder.position[i + 2] > highest) {
        highest = builder.position[i + 2];
        site = builder.position.slice(i, i + 3);
      }
    if (site)
      builder.beacons.push(
        site[0],
        site[1],
        site[2] + 1,
        facadeRandom(seed, 11),
      );
  }
}
function ordinary(builder, f, convert, detail = true) {
  if (f.points.length > 2048 || buildingArea(f.points) < 8) return;
  const seed = featureSeed(f),
    h = resolveHeight(f, buildingArea(f.points), (seed % 1000) / 1000),
    rings = [f.points, ...(f.holes || [])].map((r) => r.map(convert));
  const type = facadeType(
    f.tags,
    h.top - h.bottom,
    buildingArea(rings[0]),
    seed,
    clean(rings[0]).length,
  );
  builder.appearance = {
    type,
    bottom: h.bottom,
    top: h.top,
    tone: facadeTone(type, seed),
  };
  if (hasObstructionLights(h.top, seed) && builder.beacons.length < 4096 * 4) {
    const ring = clean(rings[0]);
    for (const i of [0, Math.floor(ring.length / 2)])
      builder.beacons.push(...ring[i], h.top + 1.2, facadeRandom(seed, 11));
  }
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
      detail &&
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
export function snapshotGeometry(city, limit, zoom = 15) {
  const builder = new MeshBuilder(limit),
    convert = (p) => snapshotPoint(p, city.center),
    plan = resolveRenderPlan(city, LANDMARK_PACK.profiles),
    activity = districtField(city),
    boxes = [];
  for (const m of plan.models)
    model(builder, m.feature, m.anchor, m.profile, convert);
  for (const { feature, kind } of plan.normal) {
    if (kind === "frame" && !builder.truncated) {
      const m = genericTower(feature);
      model(builder, feature, m.anchor, m.profile, convert);
    } else {
      const first = builder.color.length,
        brightness = 0.72 + activity(...buildingCenter(feature.points)) * 0.6;
      const count = builder.buildings;
      ordinary(builder, feature, convert, zoom >= 14.2);
      if (builder.buildings === count) boxFallback(boxes, feature, convert);
      for (let i = first; i < builder.color.length; i++)
        builder.color[i] *= brightness;
    }
  }
  return {
    ...builder.finish(),
    boxes: new Float32Array(boxes),
    landmarks: plan.models.map((m) => ({
      id: m.profile.id,
      anchor: m.profile.anchor,
      height: m.profile.height,
    })),
    placeLabels: selectLandmarks(city)
      .filter(
        (p) =>
          !plan.models.some(
            (m) =>
              Math.hypot(p.point[0] - m.anchor[0], p.point[1] - m.anchor[1]) <
              Math.max(80, m.profile.radius),
          ),
      )
      .map((p) => ({
        id: p.sourceId,
        names: { en: landmarkName(p, "en"), "zh-TW": landmarkName(p, "zh-TW") },
        anchor: [
          city.center[0] +
            p.point[0] / (111320 * Math.cos((city.center[1] * Math.PI) / 180)),
          city.center[1] - p.point[1] / 111320,
        ],
        height: p.tags.building
          ? resolveHeight(p, p.area, (featureSeed(p) % 1000) / 1000).top
          : 2,
      })),
  };
}
// Distant overflow remains volumetric in one instanced draw. The longest footprint
// edge defines its orientation; height/min-height retain the OSM source semantics.
function boxFallback(boxes, f, convert) {
  const ring = clean(f.points).map(convert);
  if (ring.length < 3 || buildingArea(ring) < 8) return;
  let angle = 0,
    longest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  const c = Math.cos(angle),
    s = Math.sin(angle);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const [x, y] of ring) {
    const u = x * c + y * s,
      v = -x * s + y * c;
    x0 = Math.min(x0, u);
    x1 = Math.max(x1, u);
    y0 = Math.min(y0, v);
    y1 = Math.max(y1, v);
  }
  const x = (x0 + x1) / 2,
    y = (y0 + y1) / 2,
    seed = featureSeed(f);
  const h = resolveHeight(f, buildingArea(ring), (seed % 1000) / 1000);
  const type = facadeType(
    f.tags,
    h.top - h.bottom,
    buildingArea(ring),
    seed,
    ring.length,
  );
  const tone = facadeTone(type, seed);
  boxes.push(
    x * c - y * s,
    x * s + y * c,
    h.bottom,
    x1 - x0,
    y1 - y0,
    h.top - h.bottom,
    c,
    s,
    ...tone,
    type * 10000 + (seed % 10000),
  );
}
export function vectorGeometry(features, center, limit, zoom = 15) {
  const builder = new MeshBuilder(limit),
    boxes = [];
  for (const f of features) {
    if ([true, 1, "true", "1"].includes(f.properties?.hide_3d)) continue;
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
      const feature = {
        sourceId: `tile/${f.id ?? "anonymous"}/${rings[0][0].map((n) => n.toFixed(7)).join("/")}`,
        tags: {
          ...Object.fromEntries(
            Object.entries(f.properties || {}).filter(([key]) =>
              [
                "building",
                "building:part",
                "building:use",
                "building:material",
                "office",
                "tourism",
              ].includes(key),
            ),
          ),
          building: f.properties?.building || f.properties?.subclass || "yes",
          ...(h > 0 ? { height: String(h) } : {}),
          ...(min > 0 ? { min_height: String(min) } : {}),
        },
        points: projected[0],
        holes: projected.slice(1),
      };
      const count = builder.buildings;
      ordinary(builder, feature, (p) => p, zoom >= 14.2);
      if (builder.buildings === count) boxFallback(boxes, feature, (p) => p);
    }
  }
  return { ...builder.finish(), boxes: new Float32Array(boxes) };
}
