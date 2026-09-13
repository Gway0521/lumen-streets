import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleRings, parseCity, inside } from "../src/city.js";
import { buildGraph, Traffic, green, canDrive } from "../src/traffic.js";

const way = (id, nodes, points, tags = {}) => ({
  id,
  nodes,
  points,
  tags: { highway: "primary", ...tags },
});
const fixture = (roads) => ({ roads, bounds: [-600, -600, 600, 600] });
test("a multipolygon ring joins reversed, unordered fragments and preserves a hole", () => {
  const geometry = (points) => points.map(([lon, lat]) => ({ lon, lat }));
  const outer = assembleRings([
    {
      geometry: geometry([
        [2, 2],
        [2, 0],
      ]),
    },
    {
      geometry: geometry([
        [0, 0],
        [0, 2],
        [2, 2],
      ]),
    },
    {
      geometry: geometry([
        [0, 0],
        [2, 0],
      ]),
    },
  ]);
  assert.equal(outer.length, 1);
  assert.deepEqual(outer[0][0], outer[0].at(-1));
  assert(inside([1, 1], outer[0]));
  assert.deepEqual(
    assembleRings([
      {
        geometry: geometry([
          [0, 0],
          [1, 1],
        ]),
      },
    ]),
    [],
    "open geometry is not silently filled",
  );
  const raw = {
    pocketPlaces: { bbox: [25, 121.5, 25.1, 121.6] },
    elements: [
      {
        type: "relation",
        id: 9,
        tags: { building: "yes" },
        members: [
          {
            type: "way",
            ref: 1,
            role: "outer",
            geometry: geometry([
              [121.55, 25.03],
              [121.56, 25.03],
              [121.56, 25.04],
              [121.55, 25.04],
              [121.55, 25.03],
            ]),
          },
          {
            type: "way",
            ref: 2,
            role: "inner",
            geometry: geometry([
              [121.552, 25.032],
              [121.554, 25.032],
              [121.554, 25.034],
              [121.552, 25.034],
              [121.552, 25.032],
            ]),
          },
        ],
      },
    ],
  };
  assert.equal(parseCity(raw, "xinyi").buildings[0].holes.length, 1);
});
test("car graph respects forward and reversed one-way streets and excludes footpaths", () => {
  const graph = buildGraph(
    fixture([
      way(
        1,
        [1, 2],
        [
          [0, 0],
          [100, 0],
        ],
        { oneway: "yes" },
      ),
      way(
        2,
        [2, 3],
        [
          [100, 0],
          [200, 0],
        ],
        { oneway: "-1" },
      ),
      way(
        3,
        [3, 4],
        [
          [200, 0],
          [300, 0],
        ],
        { highway: "footway" },
      ),
    ]),
  );
  assert(graph.edges.some((e) => e.from.id === 1 && e.to.id === 2));
  assert(!graph.edges.some((e) => e.from.id === 2 && e.to.id === 1));
  assert(graph.edges.some((e) => e.from.id === 3 && e.to.id === 2));
  assert(!graph.edges.some((e) => e.from.id === 2 && e.to.id === 3));
  assert(!canDrive({ highway: "service", access: "private" }));
  assert(!graph.nodes.has(4));
});
test("red light stops a car, then green releases it across the junction", () => {
  const graph = buildGraph(
    fixture([
      way(
        1,
        [1, 2, 3],
        [
          [-200, 0],
          [0, 0],
          [200, 0],
        ],
      ),
      way(
        2,
        [4, 2, 5],
        [
          [0, -200],
          [0, 0],
          [0, 200],
        ],
      ),
    ]),
  );
  assert.equal(graph.signals.length, 1);
  const edge = graph.edges.find((e) => e.from.id === 4 && e.to.id === 2),
    next = graph.edges.find((e) => e.from.id === 2 && e.to.id === 5);
  assert.equal(green(edge, 1), false);
  assert.equal(green(edge, 18), true);
  const sim = new Traffic(graph);
  sim.cars = [
    {
      id: 1,
      edge,
      next,
      s: 160,
      speed: 9,
      maxSpeed: 12,
      length: 4.4,
      age: 3,
      stopped: 0,
    },
  ];
  for (let i = 0; i < 200; i++) sim.update(0.05);
  assert(sim.cars[0].s < edge.length - 10);
  assert.equal(sim.cars[0].edge, edge);
  assert(sim.cars[0].speed < 0.5);
  for (let i = 0; i < 240; i++) sim.update(0.05);
  assert.notEqual(sim.cars[0].edge, edge);
});
test("following cars keep a gap instead of overtaking their leader", () => {
  const graph = buildGraph(
      fixture([
        way(
          1,
          [1, 2],
          [
            [0, 0],
            [500, 0],
          ],
        ),
      ]),
    ),
    edge = graph.edges[0],
    sim = new Traffic(graph);
  sim.cars = [
    {
      id: 1,
      edge,
      next: null,
      s: 80,
      speed: 4,
      maxSpeed: 4,
      length: 4.4,
      age: 3,
      stopped: 0,
    },
    {
      id: 2,
      edge,
      next: null,
      s: 60,
      speed: 12,
      maxSpeed: 12,
      length: 4.4,
      age: 3,
      stopped: 0,
    },
  ];
  for (let i = 0; i < 200; i++) {
    sim.update(0.05);
    assert(sim.cars[1].s + sim.cars[0].length + 1.9 <= sim.cars[0].s);
  }
});
test("both real snapshots form usable networks and keep finite state during a minute of traffic", () => {
  for (const id of ["xinyi", "ntu"]) {
    const raw = JSON.parse(
        readFileSync(
          new URL("../public/data/" + id + ".json", import.meta.url),
          "utf8",
        ),
      ),
      city = parseCity(raw, id),
      graph = buildGraph(city),
      sim = new Traffic(graph);
    assert(city.buildings.length > 2000);
    assert(graph.signals.length > 20);
    assert(city.buildings.some((b) => b.holes?.length));
    sim.setCount(500);
    for (let i = 0; i < 1200; i++) sim.update(0.05);
    assert.equal(sim.cars.length, 500);
    for (const c of sim.cars) {
      assert(Number.isFinite(c.s));
      assert(c.s >= 0);
      assert(Number.isFinite(c.speed));
      assert(c.edge.to && c.edge.from);
    }
    sim.setCount(0);
    assert.equal(sim.cars.length, 0);
  }
});
