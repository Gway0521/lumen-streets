import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentBuilder } from "../src/three/environment.js";
import { localPoint } from "../src/three/geo.js";

// Geometry tests need only the canvas drawing interface; real pixels are checked in Edge.
globalThis.OffscreenCanvas = class {
  constructor(width, height) {
    Object.assign(this, { width, height });
  }
  getContext() {
    return {
      fillRect() {},
      scale() {},
      translate() {},
      createRadialGradient() {
        return { addColorStop() {} };
      },
    };
  }
  transferToImageBitmap() {
    return { width: this.width, height: this.height };
  }
};
const origin = [0, 0],
  bounds = [-0.01, -0.01, 0.01, 0.01];
const polygon = (rings) => ({
  geometry: { type: "Polygon", coordinates: rings },
  properties: {},
});
const square = (r) => [
  [-r, -r],
  [r, -r],
  [r, r],
  [-r, r],
  [-r, -r],
];
const road = (brunnel) => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [-0.009, 0],
      [0.009, 0],
    ],
  },
  properties: { class: "primary", brunnel },
});

test("water triangulation retains island holes and finite local coordinates", () => {
  const b = new EnvironmentBuilder(origin, bounds, false);
  b.addPolygon(polygon([square(0.008), square(0.002)]), "water");
  const { water } = b.finish();
  let area = 0;
  for (let i = 0; i < water.length; i += 9) {
    const [ax, ay, , bx, by, , cx, cy] = water.slice(i, i + 9);
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    const middle = [(ax + bx + cx) / 3, (ay + by + cy) / 3];
    const hole = localPoint(0.002, 0.002, origin);
    assert.ok(
      Math.abs(middle[0]) >= Math.abs(hole[0]) ||
        Math.abs(middle[1]) >= Math.abs(hole[1]),
    );
  }
  const outer = localPoint(0.008, 0.008, origin),
    inner = localPoint(0.002, 0.002, origin);
  const expected =
    Math.abs(outer[0] * outer[1] * 4) - Math.abs(inner[0] * inner[1] * 4);
  assert.ok(Math.abs(area / expected - 1) < 1e-6);
  assert.ok(water.every(Number.isFinite));
});

test("tunnels emit no lights; bridge lights clear decks and repeated roads deduplicate", () => {
  const b = new EnvironmentBuilder(origin, bounds, false);
  b.addRoad(road("tunnel"));
  assert.equal(b.finish().lamps.length, 0);
  b.addRoad(road("bridge"));
  const first = b.lampPoints.length;
  b.addRoad(road("bridge"));
  assert.equal(b.lampPoints.length, first);
  const data = b.finish();
  assert.ok(data.bridges.length > 0 && data.lamps.length > 0);
  for (let i = 2; i < data.lamps.length; i += 3) assert.ok(data.lamps[i] > 4);
  for (let i = 1; i < data.lamps.length; i += 3)
    assert.equal(Math.abs(data.lamps[i]), 9);
});

test("nearby shore lights share the road point budget", () => {
  const b = new EnvironmentBuilder(origin, bounds, false);
  b.addRoad(road());
  b.shore = [
    [100, 0],
    [200, 0],
  ];
  const count = b.lampPoints.length;
  assert.equal(b.finish().lamps.length, count + 6);
  b.lampPoints = new Array(90000).fill(0);
  assert.equal(b.finish().lamps.length, 90000);
});

test("terrain budgets retain whole triangles and bound texture dimensions", () => {
  for (const mobile of [true, false]) {
    const b = new EnvironmentBuilder(origin, bounds, mobile);
    const f = polygon([square(0.008)]);
    for (let i = 0; i < 13000; i++) b.addPolygon(f, "green");
    const data = b.finish();
    assert.ok(data.green.length <= (mobile ? 90000 : 210000));
    assert.equal(data.green.length % 9, 0);
    assert.ok(
      Math.max(data.light.width, data.light.height) <= (mobile ? 1024 : 2048),
    );
  }
});
