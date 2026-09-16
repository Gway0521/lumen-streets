import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MeshBuilder,
  snapshotGeometry,
  vectorGeometry,
} from "../src/three/geometry.js";
import { parseCity } from "../src/city.js";
import {
  mercator,
  unproject,
  localPoint,
  viewRecipe,
  detailLevel,
} from "../src/three/geo.js";
import { inspectGLB } from "../src/three/model-import.js";
import { messages } from "../src/three/locales.js";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { nightStyle } from "../src/three/style.js";
import { packGraph, unpackGraph } from "../src/three/graph-wire.js";
import { buildGraph, Traffic } from "../src/traffic.js";
import { coveringBuildings } from "../src/three/tiles.js";
import { compactVolumes } from "../src/three/volumes.js";
import { CityStream } from "../src/three/stream.js";

test("a cancelled build at the same camera can be scheduled again", () => {
  const PreviousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {}
  };
  const map = { on() {}, off() {}, getZoom: () => 16.5 };
  const stream = new CityStream(map, {}, { mobile: false, status() {} });
  try {
    stream.lastKey = "same-camera";
    stream.busy = true;
    stream.moved();
    let closed = 0;
    stream.worker.onmessage({
      data: {
        generation: stream.generation - 1,
        environment: {
          light: {
            close() {
              closed++;
            },
          },
        },
      },
    });
    assert.equal(stream.lastKey, "");
    assert.equal(stream.busy, false);
    assert.equal(stream.pending, false);
    assert.ok(stream.timer);
    assert.equal(closed, 1);
  } finally {
    stream.dispose();
    globalThis.Worker = PreviousWorker;
  }
});
test("night style validates against the installed map renderer", () =>
  assert.deepEqual(validateStyleMin(nightStyle()), []));
test("3D coordinates remain local and roundtrip across the antimeridian", () => {
  for (const p of [
    [121.492, 31.239],
    [-77, 38],
    [179.999, 65],
  ]) {
    const q = unproject(...mercator(...p));
    assert.ok(Math.hypot(...q.map((n, i) => n - p[i])) < 1e-9);
  }
  assert.ok(Math.abs(localPoint(-179.999, 0, [179.999, 0])[0]) < 230);
  const r = viewRecipe({
    lng: Infinity,
    lat: 100,
    zoom: 90,
    pitch: -40,
    glow: "bad",
  });
  assert.equal(r.lng, 121.4938);
  assert.equal(r.lat, 80);
  assert.equal(r.zoom, 16.5);
  assert.equal(r.pitch, 0);
  assert.equal(r.glow, 1);
  assert.equal(detailLevel(10), "map");
  assert.notEqual(detailLevel(12.3), "map");
  assert.ok(viewRecipe().zoom < 14);
});
test("distant coverage uses building-detail tiles, wraps longitude and bounds requests", () => {
  const result = coveringBuildings([121.44, 31.2, 121.55, 31.29]);
  assert.equal(result.limited, false);
  assert.ok(result.tiles.length > 10);
  assert.ok(result.tiles.every((t) => t.z === 14));
  const crossing = coveringBuildings([179.99, 0, -179.99, 0.01]);
  assert.equal(crossing.limited, false);
  assert.ok(crossing.tiles.some((t) => t.x === 0));
  assert.ok(crossing.tiles.some((t) => t.x === 16383));
  const bounded = coveringBuildings([121, 30, 121.3, 30.3], 24);
  assert.equal(bounded.tiles.length, 24);
  assert.equal(bounded.limited, true);
});
test("exhausting facade detail preserves every building as finite oriented volume", () => {
  const features = Array.from({ length: 150 }, (_, i) => ({
    id: i,
    properties: { render_height: 83, render_min_height: 5 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [121 + i * 0.001, 25],
          [121 + i * 0.001 + 0.0004, 25],
          [121 + i * 0.001 + 0.0004, 25.0004],
          [121 + i * 0.001, 25.0004],
          [121 + i * 0.001, 25],
        ],
      ],
    },
  }));
  const g = vectorGeometry(features, [121, 25], 500, 13);
  assert.ok(g.truncated);
  assert.equal(g.buildings + g.boxes.length / 12, features.length);
  assert.ok(g.boxes.every(Number.isFinite));
  for (let i = 0; i < g.boxes.length; i += 12) {
    assert.equal(g.boxes[i + 2], 5);
    assert.equal(g.boxes[i + 5], 78);
    assert.ok(g.boxes[i + 3] > 0 && g.boxes[i + 4] > 0);
  }
});
test("dense low roofs merge spatially while a tall landmark retains its own volume", () => {
  const boxes = [];
  for (let i = 0; i < 1000; i++)
    boxes.push(
      (i % 50) * 4,
      Math.floor(i / 50) * 4,
      0,
      3,
      3,
      8,
      1,
      0,
      0.1,
      0.15,
      0.2,
      i,
    );
  boxes.push(100, 100, 0, 20, 20, 300, 1, 0, 0.1, 0.15, 0.2, 5000);
  const compact = compactVolumes(new Float32Array(boxes), 100);
  assert.ok(compact.length / 12 <= 100);
  assert.ok(compact.every(Number.isFinite));
  assert.ok(Array.from(compact).some((v, i) => i % 12 === 5 && v === 300));
  const occupied = new Set();
  for (let i = 0; i < compact.length; i += 12)
    occupied.add(
      `${Math.floor(compact[i] / 80)}/${Math.floor(compact[i + 1] / 80)}`,
    );
  assert.ok(
    occupied.size >= 3,
    "aggregation must retain separate neighbourhoods",
  );
});
test("3D roof triangulation preserves courtyard holes and minimum elevations", () => {
  const b = new MeshBuilder();
  b.solid(
    [
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
      [
        [5, 5],
        [5, 15],
        [15, 15],
        [15, 5],
      ],
    ],
    8,
    20,
    1,
  );
  const { position, normal } = b.finish();
  let area = 0;
  for (let i = 0; i < position.length; i += 9) {
    if (Math.abs(normal[i + 2]) < 0.9) continue;
    const [ax, ay, , bx, by, , cx, cy] = position.slice(i, i + 9);
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  assert.equal(area, 300);
  for (let i = 2; i < position.length; i += 3)
    assert.ok(position[i] >= 8 && position[i] <= 20);
});
test("vector tile degrees become metre geometry and retain mapped heights", () => {
  const g = vectorGeometry(
    [
      {
        id: 1,
        properties: { render_height: 83, render_min_height: 5 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [121, 25],
              [121.001, 25],
              [121.001, 25.001],
              [121, 25.001],
              [121, 25],
            ],
          ],
        },
      },
    ],
    [121, 25],
    10000,
  );
  assert.equal(g.buildings, 1);
  assert.ok(g.position.length > 0);
  assert.ok(g.position.every(Number.isFinite));
  const heights = g.position.filter((_, i) => i % 3 === 2);
  assert.ok(heights.includes(83));
  assert.ok(Math.max(...heights) <= 85);
  assert.equal(Math.min(...heights), 5);
});
test("Shanghai emits all four source landmarks with finite physical geometry", async () => {
  const raw = JSON.parse(
      await readFile(new URL("../public/data/shanghai.json", import.meta.url)),
    ),
    city = parseCity(raw, "shanghai"),
    g = snapshotGeometry(city, 700000);
  assert.equal(g.landmarks.length, 4);
  assert.ok(g.placeLabels.length > 0 && g.placeLabels.length <= 32);
  for (const p of g.placeLabels) {
    assert.ok(p.anchor.every(Number.isFinite));
    assert.ok(Number.isFinite(p.height));
    assert.ok(p.names.en && p.names["zh-TW"]);
  }
  assert.ok(g.position.every(Number.isFinite));
  assert.ok(g.position.length / 3 <= 700000);
  assert.ok(g.position.some((v, i) => i % 3 === 2 && v === 632));
  assert.equal(g.normal.length, g.position.length);
});
function glb(patch = {}) {
  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, type: "VEC3", count: 3 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
    ...patch,
  };
  const text = JSON.stringify(doc),
    json = new TextEncoder().encode(
      text + " ".repeat((4 - (text.length % 4)) % 4),
    ),
    buffer = new ArrayBuffer(28 + json.length + 36),
    view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, json.length, 0x4e4f534a].forEach((v, i) =>
    view.setUint32(i * 4, v, true),
  );
  new Uint8Array(buffer, 20, json.length).set(json);
  view.setUint32(20 + json.length, 36, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  return buffer;
}
test("GLB input rejects remote resources, cyclic nodes, instance amplification and malformed chunks", () => {
  assert.equal(inspectGLB(glb()).triangles, 1);
  assert.throws(
    () =>
      inspectGLB(
        glb({
          buffers: [{ uri: "https://example.test/a.bin", byteLength: 36 }],
        }),
      ),
    /embedded/,
  );
  assert.throws(
    () => inspectGLB(glb({ nodes: [{ mesh: 0, children: [0] }] })),
    /cyclic/,
  );
  assert.throws(
    () =>
      inspectGLB(
        glb({
          meshes: [
            {
              primitives: Array.from({ length: 20001 }, () => ({
                attributes: { POSITION: 0 },
              })),
            },
          ],
        }),
      ),
    /20,000/,
  );
  assert.throws(() => inspectGLB(glb({ textures: [{}] })), /textures/);
  const bad = glb();
  new DataView(bad).setUint32(8, 12, true);
  assert.throws(() => inspectGLB(bad), /header/);
});
test("3D editor locales expose the same controls", () =>
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages["zh-TW"]).sort(),
  ));
test("dense Taipei road graph crosses the worker boundary without recursive cloning", async () => {
  const city = parseCity(
      JSON.parse(
        await readFile(new URL("../public/data/xinyi.json", import.meta.url)),
      ),
      "xinyi",
    ),
    original = buildGraph(city),
    copy = unpackGraph(structuredClone(packGraph(original)));
  assert.equal(copy.edges.length, original.edges.length);
  assert.equal(copy.nodes.size, original.nodes.size);
  const a = new Traffic(original),
    b = new Traffic(copy);
  a.setCount(50);
  b.setCount(50);
  for (let i = 0; i < 60; i++) {
    a.update(0.05);
    b.update(0.05);
  }
  assert.deepEqual(b.snapshot(), a.snapshot());
});
