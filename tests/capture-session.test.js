import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/three/capture-session.ts";

test("capture restores one checkpoint on success, failure or cancellation", () => {
  const checkpoint = { time: 4, serial: 1, randomState: 42, cars: [] };
  const layer = { time: 4, accumulator: .01, playing: true, capturing: false,
    traffic: { snapshot: () => checkpoint, restore(value) { assert.deepEqual(value, checkpoint); } } };
  const stream = { locked: false, generation: 2 };
  const capture = new CaptureSession(layer, stream);
  capture.begin();
  assert.equal(stream.generation, 3);
  assert.equal(stream.locked, true);
  assert.equal(layer.playing, false);
  assert.throws(() => capture.begin(), /already active/);
  layer.time = 300; layer.accumulator = 0;
  capture.restore(); capture.restore();
  assert.equal(layer.time, 4);
  assert.equal(layer.accumulator, .01);
  assert.equal(layer.playing, true);
  assert.equal(layer.capturing, false);
  assert.equal(stream.locked, false);
  capture.begin();
  layer.traffic.restore = () => { throw Error("invalid graph"); };
  assert.throws(() => capture.restore(), /invalid graph/);
  assert.equal(stream.locked, false);
  assert.equal(layer.capturing, false);
});
