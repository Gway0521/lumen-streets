import test from "node:test";
import assert from "node:assert/strict";
import {
  buildingPolygons,
} from "../src/three/building-source.js";
import { vectorGeometry } from "../src/three/geometry.js";
const polygon = (x, y) => [
  [
    [x, y],
    [x + 0.0001, y],
    [x + 0.0001, y + 0.0001],
    [x, y + 0.0001],
    [x, y],
  ],
];
const grouped = {
  id: 1,
  properties: { render_height: 5 },
  geometry: {
    type: "MultiPolygon",
    coordinates: [polygon(1, 1), polygon(3, 3)],
  },
};
test("3D outline flags suppress shells without suppressing visible parts", () => {
  for (const hide_3d of [true, 1, "true", "1"]) {
    const hidden = {
      ...grouped,
      properties: { ...grouped.properties, hide_3d },
    };
    assert.equal(buildingPolygons([hidden]).length, 0);
    assert.equal(vectorGeometry([hidden], [1, 1], 10000).position.length, 0);
  }
  assert.equal(
    buildingPolygons([{ ...grouped, properties: { hide_3d: false } }]).length,
    2,
  );
});
test("facades keep their identity when grouped footprints are split or reordered", () => {
  const combined = vectorGeometry([grouped], [1, 1], 10000);
  const split = vectorGeometry(buildingPolygons([grouped]), [1, 1], 10000);
  assert.deepEqual(combined.seed, split.seed);
  assert.deepEqual(combined.facade, split.facade);
});
