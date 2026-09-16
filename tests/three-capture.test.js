import test from "node:test";
import assert from "node:assert/strict";
import { ASPECTS, captureSize } from "../src/three/composition.js";
import { storedZip } from "../src/three/contribution.js";
import {
  validateScene,
  trafficRecipe,
  restoreTraffic,
} from "../src/three/scene-recipe.js";
import { Traffic, buildGraph } from "../src/traffic.js";
test("all wallpaper ratios have bounded, even video dimensions and exact 16:9/9:20 presets", () => {
  for (const aspect of Object.values(ASPECTS))
    for (const format of ["png", "gif", "video"]) {
      const [w, h] = captureSize(aspect, 3840, format);
      assert.ok(w * h <= 16e6);
      assert.ok(Math.abs(w / h - aspect) < 0.01);
      if (format === "video") {
        assert.equal(w % 2, 0);
        assert.equal(h % 2, 0);
        assert.ok(Math.max(w, h) <= 2560);
      }
    }
  assert.deepEqual(captureSize(16 / 9, 1920, "video"), [1920, 1080]);
  assert.deepEqual(captureSize(9 / 20, 1920, "png"), [864, 1920]);
  assert.throws(() => captureSize(Infinity, 1920, "png"));
  assert.throws(() => captureSize(0.1, 1920, "png"));
});
test("ZIP writes a readable central directory with fixed safe paths", async () => {
  const zip = storedZip([
    { name: "README.txt", bytes: new TextEncoder().encode("nightscape") },
  ]);
  const b = await zip.arrayBuffer(),
    v = new DataView(b);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(b.byteLength - 22, true), 0x06054b50);
  const offset = v.getUint32(b.byteLength - 6, true);
  assert.equal(v.getUint32(offset, true), 0x02014b50);
  assert.equal(v.getUint32(18, true), 10);
  assert.throws(() =>
    storedZip([{ name: "../model.glb", bytes: new Uint8Array() }]),
  );
});
const scene = {
  format: "lumen-streets-view",
  version: 1,
  view: {
    city: "shanghai",
    lng: 121,
    lat: 31,
    zoom: 15,
    pitch: 50,
    bearing: 0,
    glow: 1,
    density: 700,
  },
  time: 42,
  playing: false,
  aspect: 16 / 9,
  composition: {
    quiet: { edge: "top", brightness: 35, area: 70 },
    placeTitle: { text: "上海", size: "medium", corner: "top-left" },
    landmarkLabels: true,
  },
};
test("scene validation rejects corrupt clocks, coordinates, captions and over-budget traffic", () => {
  assert.equal(validateScene(scene).composition.placeTitle.text, "上海");
  for (const value of [
    { ...scene, time: NaN },
    { ...scene, view: { ...scene.view, lat: 200 } },
    {
      ...scene,
      composition: {
        placeTitle: {
          text: "a".repeat(121),
          size: "medium",
          corner: "top-left",
        },
      },
    },
    { ...scene, version: 9 },
  ])
    assert.throws(() => validateScene(value));
});
test("traffic recipes remap stable road endpoints and preserve the exact checkpoint", () => {
  const graph = buildGraph({
    roads: [
      {
        id: "test",
        nodes: [1, 2, 3],
        points: [
          [0, 0],
          [200, 0],
          [400, 0],
        ],
        tags: { highway: "residential" },
      },
    ],
    bounds: [-100, -100, 500, 100],
  });
  const traffic = new Traffic(graph);
  traffic.setCount(12);
  traffic.update(0.05);
  const before = traffic.snapshot(),
    recipe = trafficRecipe(traffic);
  const parsed = validateScene({ ...scene, traffic: recipe });
  traffic.update(1);
  assert.equal(restoreTraffic(traffic, parsed.traffic), true);
  assert.deepEqual(traffic.snapshot(), before);
  assert.throws(() =>
    validateScene({
      ...scene,
      traffic: { ...recipe, cars: [{ ...recipe.cars[0], speed: -1 }] },
    }),
  );
});
