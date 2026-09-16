import test from "node:test";
import assert from "node:assert/strict";
import {
  buildingPolygons,
  snapshotCoverage,
  uniqueBuildingShells,
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
test("snapshot exclusion keeps the outside member of a grouped footprint", () => {
  const covered = snapshotCoverage({
    center: [1, 1],
    buildings: [
      {
        points: [
          [0, 0],
          [20, 0],
          [20, -20],
          [0, -20],
          [0, 0],
        ],
      },
    ],
  });
  const result = buildingPolygons([grouped]).filter((f) => !covered(f));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].geometry.coordinates, polygon(3, 3));
});

test("duplicate ways and relation shells share one exterior while podiums and raised parts survive", () => {
  const shell = (id, top, bottom = 0, x = 0) => ({
    id,
    properties: { render_height: top, render_min_height: bottom },
    geometry: { type: "Polygon", coordinates: polygon(x, 0) },
  });
  const tall = shell(1, 120),
    duplicate = shell(2, 118, 0, 0.000005),
    podium = shell(3, 18),
    raised = shell(4, 150, 120),
    neighbour = shell(5, 120, 0, 0.00011);
  assert.deepEqual(
    uniqueBuildingShells([duplicate, tall, podium, raised, neighbour])
      .map((f) => f.id)
      .sort(),
    [1, 3, 4, 5],
  );
  assert.deepEqual(
    uniqueBuildingShells([neighbour, raised, podium, tall, duplicate])
      .map((f) => f.id)
      .sort(),
    [1, 3, 4, 5],
  );
  const hollow = structuredClone(tall);
  hollow.id = 6;
  hollow.geometry.coordinates.push(
    polygon(0.000025, 0.000025)[0].map(([x, y]) => [x * 0.4, y * 0.4]),
  );
  assert.equal(uniqueBuildingShells([tall, hollow]).length, 2);
});

test("snapshot parts cover a combined tile outline without filling courtyards or gaps", () => {
  const part = (x0, x1) => ({
    points: [
      [x0, 0],
      [x1, 0],
      [x1, 100],
      [x0, 100],
      [x0, 0],
    ],
  });
  const outline = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [100 / 111320, 0],
          [100 / 111320, -100 / 111320],
          [0, -100 / 111320],
          [0, 0],
        ],
      ],
    },
  };
  assert.equal(
    snapshotCoverage({
      center: [0, 0],
      buildings: [part(0, 50), part(50, 100)],
    })(outline),
    true,
  );
  assert.equal(
    snapshotCoverage({
      center: [0, 0],
      buildings: [part(0, 30), part(70, 100)],
    })(outline),
    false,
  );
  const courtyard = part(0, 100);
  courtyard.holes = [
    [
      [35, 35],
      [65, 35],
      [65, 65],
      [35, 65],
      [35, 35],
    ],
  ];
  assert.equal(
    snapshotCoverage({ center: [0, 0], buildings: [courtyard] })(outline),
    false,
  );
});
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
test("snapshot coverage matches actual footprints, not the query rectangle", () => {
  const center = [0, 0],
    points = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
  const covered = snapshotCoverage({ center, buildings: [{ points }] });
  const feature = (x, y) => ({
    geometry: { type: "Polygon", coordinates: polygon(x, y) },
  });
  assert.equal(covered(feature(0.0001, -0.0002)), true);
  assert.equal(covered(feature(0.002, -0.0002)), false);
  assert.equal(snapshotCoverage(null)(feature(0.0001, -0.0002)), false);
});
