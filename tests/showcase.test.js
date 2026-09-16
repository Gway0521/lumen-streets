import test from "node:test";
import assert from "node:assert/strict";
import { presets } from "../src/three/presets.js";
import { viewRecipe, localPoint } from "../src/three/geo.js";
import {
  showcaseLandmarks,
  profileForLandmark,
  nearbyLandmarks,
  landmarkCoverage,
  SHOWCASE_VERTEX_BUDGET,
} from "../src/three/showcase.js";
import { landmarkGeometry } from "../src/three/geometry.js";
import { validateScene } from "../src/three/scene-recipe.js";

test("showcases balance four groups, retain requested cities and preserve retired links", () => {
  const groups = Object.groupBy(Object.values(presets), (p) => p.group);
  assert.equal(Object.keys(groups).length, 4);
  for (const items of Object.values(groups)) {
    assert.equal(items.length, 2);
    assert.ok(items.some((p) => p.waterfront));
  }
  for (const id of ["xinyi", "sapporo", "shanghai"]) assert.ok(presets[id]);
  for (const id of [
    ...Object.keys(presets),
    "tokyo",
    "ntu",
    "beijing",
    "washington",
  ])
    assert.equal(viewRecipe({ city: id }).city, id);
  assert.equal(viewRecipe({ city: "__proto__" }).city, "shanghai");
});

test("each reviewed landmark has finite reproducible geometry, sources and bounded local dimensions", () => {
  const ids = new Set();
  for (const p of showcaseLandmarks) {
    assert.ok(!ids.has(p.id));
    ids.add(p.id);
    assert.ok(p.osm.every((s) => /^(node|way|relation)\/\d+$/.test(s)));
    assert.ok(p.names.en && p.names["zh-TW"] && p.heightBasis);
    assert.ok(
      Math.hypot(...localPoint(...p.anchor, presets[p.city].center)) < 3100,
      p.id,
    );
    const profile = profileForLandmark(p),
      g = landmarkGeometry([profile], p.anchor, SHOWCASE_VERTEX_BUDGET);
    assert.equal(g.omitted, 0, p.id);
    assert.equal(g.landmarks.length, 1);
    assert.ok(g.position.length > 0 && g.position.length % 9 === 0);
    assert.ok(g.position.every(Number.isFinite));
    assert.ok(g.normal.every(Number.isFinite));
    // Splayed cylindrical supports may extend up to a radius below the ground plane.
    for (let i = 2; i < g.position.length; i += 3)
      assert.ok(g.position[i] >= -3 && g.position[i] <= p.height + 3, p.id);
    assert.deepEqual(
      g.position,
      landmarkGeometry([profile], p.anchor, SHOWCASE_VERTEX_BUDGET).position,
    );
  }
  assert.equal(ids.size, 51);
});

test("all assemblies for each showcase fit the reserved vertex budget", () => {
  for (const [id, p] of Object.entries(presets)) {
    const records = showcaseLandmarks.filter((m) => m.city === id);
    const g = landmarkGeometry(
      records.map(profileForLandmark),
      p.center,
      SHOWCASE_VERTEX_BUDGET,
    );
    assert.equal(g.omitted, 0, id);
    assert.ok(g.position.length / 3 <= SHOWCASE_VERTEX_BUDGET);
    const nearby = nearbyLandmarks(
      [
        p.center[0] - 0.05,
        p.center[1] - 0.04,
        p.center[0] + 0.05,
        p.center[1] + 0.04,
      ],
      p.center,
    );
    assert.ok(nearby.every((m) => m.city === id));
  }
  assert.deepEqual(nearbyLandmarks([0, 0, 1, 1], [0, 0]), []);
});

test("landmark budget rejection is atomic and leaves ordinary buildings eligible", () => {
  const p = showcaseLandmarks.find((p) => p.id === "canton-tower");
  const g = landmarkGeometry([profileForLandmark(p)], p.anchor, 30);
  assert.equal(g.omitted, 1);
  assert.equal(g.position.length, 0);
  assert.equal(g.beacons.length, 0);
  const mask = landmarkCoverage(
    showcaseLandmarks.filter((p) => g.acceptedIds.includes(p.id)),
  );
  assert.equal(
    mask.vector({
      geometry: { type: "Polygon", coordinates: [p.footprints[0]] },
    }),
    false,
  );
});

test("replacement owns reviewed footprints, not neighbouring buildings or courtyard interiors", () => {
  const p = showcaseLandmarks.find((p) => p.id === "one-wtc");
  const mask = landmarkCoverage([p]);
  const feature = (ring) => ({
    geometry: { type: "Polygon", coordinates: [ring] },
  });
  assert.equal(mask.vector(feature(p.footprints[0])), true);
  assert.equal(
    mask.vector(feature(p.footprints[0].map(([x, y]) => [x + 0.002, y]))),
    false,
  );
  const outer = [
      [0, 0],
      [0.002, 0],
      [0.002, 0.002],
      [0, 0.002],
      [0, 0],
    ],
    hole = [
      [0.0005, 0.0005],
      [0.0015, 0.0005],
      [0.0015, 0.0015],
      [0.0005, 0.0015],
      [0.0005, 0.0005],
    ];
  const courtyard = landmarkCoverage([
    { osm: [], anchor: [0, 0], footprints: [outer], holes: [hole] },
  ]);
  assert.equal(courtyard.vector(feature(outer)), true);
  assert.equal(
    courtyard.vector(
      feature([
        [0.0008, 0.0008],
        [0.0012, 0.0008],
        [0.0012, 0.0012],
        [0.0008, 0.0012],
        [0.0008, 0.0008],
      ]),
    ),
    false,
  );
});

test("live labels round-trip separately from export labels and older scenes remain valid", () => {
  const scene = {
    format: "lumen-streets-view",
    version: 1,
    view: viewRecipe({ city: "yokohama" }),
    time: 1,
    playing: false,
    aspect: 1.5,
    viewLabels: true,
    composition: { landmarkLabels: false },
  };
  const saved = validateScene(scene);
  assert.equal(saved.view.city, "yokohama");
  assert.equal(saved.viewLabels, true);
  assert.equal(saved.composition.landmarkLabels, false);
  assert.deepEqual(validateScene(JSON.parse(JSON.stringify(saved))), saved);
  delete scene.viewLabels;
  assert.equal(validateScene(scene).viewLabels, false);
  assert.throws(() => validateScene({ ...scene, viewLabels: "yes" }));
});
