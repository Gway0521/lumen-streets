import test from "node:test";
import assert from "node:assert/strict";
import { vehicleLights } from "../src/three/vehicle-lights.js";

const edge = {
  points: [
    [0, 0],
    [10, 0],
    [10, 20],
  ],
  cumulative: [0, 10, 30],
  length: 30,
  lane: 0,
};
const lights = (car, bearing = 0) => {
  const result = [];
  vehicleLights(car, bearing, (x, y, z, color) =>
    result.push({ x, y, z, color }),
  );
  return result;
};
test("short traffic exposures follow bends, stay on the current edge and preserve simulation state", () => {
  const car = { edge, s: 12, speed: 30 };
  const before = structuredClone(car),
    points = lights(car);
  assert.equal(points.length, 2);
  assert.deepEqual([points[0].x, points[0].y], [10, 2]);
  assert.deepEqual([points[1].x, points[1].y], [4, 0]);
  assert.deepEqual(car, before);
  assert.equal(lights({ ...car, s: 0 }).length, 1);
  assert.equal(lights({ ...car, speed: 0 }).length, 1);
});
test("camera-facing traffic is ivory and receding traffic is red without changing its position", () => {
  const car = { edge, s: 20, speed: 10 },
    front = lights(car),
    back = lights(car, Math.PI);
  assert.deepEqual(
    front.map((p) => [p.x, p.y]),
    back.map((p) => [p.x, p.y]),
  );
  assert.ok(front[0].color[1] > 0.8);
  assert.ok(back[0].color[1] < 0.3);
  assert.ok(front[1].color[0] < front[0].color[0]);
});
