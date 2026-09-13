import test from "node:test";
import assert from "node:assert/strict";
import { outputPlan, cropView, wallpaperPlan, frameDelay, GIF_LIMITS } from "../src/export/framing.ts";
import { paintCapture } from "../src/export/png.ts";
import { encodeCaptureVideo, supportsVideo } from "../src/export/video.ts";
import { createGIFCodec } from "../src/export/gif-codec.js";
import { GIFWorker, encodeCaptureGIF } from "../src/export/gif.ts";

test("wallpaper and GIF crops preserve the visible world center without changing source viewport", () => {
  const source = { width: 1440, height: 1000, dpr: 1.8, quietMode: false, locale: "en" };
  const original = structuredClone(source);
  for (const [size, dims] of [["desktop", [3840, 2160]], ["portrait", [1080, 1920]]]) {
    const p = outputPlan(source, size, "png");
    assert.deepEqual([p.width, p.height], dims);
    // The same camera projects the visible center to the center of every target crop.
    assert(Math.abs((p.view.width / 2 - p.view.origin[0]) - (720 - 1440 * .63)) < 1e-9);
    assert(Math.abs(p.view.height / 2 - p.view.origin[1]) < 1e-9);
    assert(p.view.width <= source.width && p.view.height <= source.height);
    const gif = outputPlan(source, size, "gif");
    assert.equal(Math.max(gif.width, gif.height), 720);
    assert(Math.abs(gif.width / gif.height - p.width / p.height) < .002);
  }
  assert.deepEqual(source, original);
  const phone = { width: 390, height: 844, dpr: 1.8 };
  const plan = outputPlan(phone, "current", "png");
  assert.deepEqual(plan.view, phone); assert.deepEqual([plan.width, plan.height], [702, 1519]);
  assert.throws(() => outputPlan(source, "huge", "png"));
  assert.throws(() => cropView({ width: NaN, height: 10 }, 200, 200));
});

test("wallpaper fills the mapped rectangle without editor margins, stretch or camera mutation", () => {
  const view = { width: 1440, height: 1000, dpr: 1.8 }, bounds = [-1200, -1000, 1200, 1000];
  for (const center of [{ x: 0, y: 0, zoom: .1 }, { x: -2000, y: 1900, zoom: 2 }]) {
    const original = structuredClone(center);
    for (const size of ["current", "desktop", "portrait"]) for (const format of ["png", "gif", "mp4", "webm"]) {
      const p = wallpaperPlan(view, bounds, center, size, format), c = p.camera;
      const hx = p.view.width / (2 * c.zoom), hy = p.view.height / (2 * c.zoom);
      assert(c.x - hx >= bounds[0] && c.x + hx <= bounds[2]);
      assert(c.y - hy >= bounds[1] && c.y + hy <= bounds[3]);
      assert.deepEqual(p.view.origin, [p.view.width / 2, p.view.height / 2]);
      assert.equal(p.view.labels, false); assert.equal(p.view.vignette, false);
      // Preview interaction must not progressively zoom an already valid camera.
      assert.deepEqual(wallpaperPlan(view, bounds, c, size, format).camera, c);
      if (["mp4", "webm"].includes(format)) { assert.equal(Math.max(p.width, p.height), 1920); assert.equal(p.width % 2, 0); assert.equal(p.height % 2, 0); }
    }
    assert.deepEqual(center, original);
  }
  assert.throws(() => wallpaperPlan(view, [0, 0, 0, 1], { x: 0, y: 0, zoom: 1 }, "desktop", "png"));
});

test("clean composition contains no burned-in title or credit; source credit is explicit", () => {
  const text = [], ctx = { setTransform() {}, fillRect() {}, measureText: s => ({ width: s.length * 7 }), fillText: s => text.push(s) };
  const engine = { render() {}, data: { source: { attribution: "© OpenStreetMap contributors · ODbL" } } };
  const canvas = { getContext: () => ctx }, options = { width: 1080, height: 1920, view: { width: 1080, height: 1920 }, title: "Brand and city should not be burned in" };
  paintCapture(engine, canvas, options); assert.deepEqual(text, []);
  paintCapture(engine, canvas, { ...options, includeCredit: true });
  assert.deepEqual(text, [engine.data.source.attribution]);
});

test("video rejects bad durations, dimensions and unavailable codecs before allocating a capture", async () => {
  const base = { width: 1920, height: 1080, seconds: 30, format: "mp4", view: { width: 1920, height: 1080 }, title: "test" };
  for (const changes of [{ seconds: 6 }, { seconds: 600 }, { width: 3840 }, { height: 1079 }])
    await assert.rejects(encodeCaptureVideo({}, { ...base, ...changes }), /Invalid video (options|duration)/);
  assert.equal(await supportsVideo("mp4", 1920, 1080), false);
  await assert.rejects(encodeCaptureVideo({}, base), /VIDEO_UNSUPPORTED/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(encodeCaptureVideo({}, { ...base, signal: controller.signal }), { name: "AbortError" });
});

function gifInfo(bytes) {
  const b = Buffer.from(bytes); assert.equal(b.subarray(0, 6).toString(), "GIF89a");
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8);
  let p = 13 + ((b[10] & 128) ? 3 * (1 << ((b[10] & 7) + 1)) : 0), frames = 0, delay = 0, localPalettes = 0;
  const blocks = () => { let n; while ((n = b[p++]) > 0) p += n; };
  while (p < b.length && b[p] !== 0x3b) {
    const kind = b[p++];
    if (kind === 0x21) {
      const label = b[p++];
      if (label === 0xf9) delay += b.readUInt16LE(p + 2) * 10;
      blocks();
    } else if (kind === 0x2c) {
      frames++; const packed = b[p + 8]; p += 9;
      if (packed & 128) { localPalettes++; p += 3 * (1 << ((packed & 7) + 1)); }
      p++; blocks();
    } else assert.fail(`Unexpected GIF block ${kind}`);
  }
  assert.equal(b[p], 0x3b); assert.equal(p, b.length - 1);
  return { width, height, frames, delay, localPalettes };
}
test("real GIF codec writes a repeatable 90-frame stream, one palette and exactly six seconds", () => {
  const encode = () => {
    const codec = createGIFCodec(128, 128), rgba = new Uint8Array(128 * 128 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([10, 20, 30, 255], i);
    for (let frame = 0; frame < GIF_LIMITS.frames; frame++) {
      const i = frame * 4; rgba.set([240, 200, 140, 255], i); codec.frame(rgba);
    }
    return codec.finish();
  };
  const a = encode(), b = encode(); assert.deepEqual(a, b);
  assert.deepEqual(gifInfo(a), { width: 128, height: 128, frames: 90, delay: 6000, localPalettes: 0 });
  assert.equal(Array.from({ length: 90 }, (_, i) => frameDelay(i)).reduce((a, b) => a + b), 6000);
  assert.throws(() => createGIFCodec(4096, 128));
  const partial = createGIFCodec(128, 128); assert.throws(() => partial.finish());
  assert.throws(() => partial.frame(new Uint8Array(3)));
});

test("worker errors, cancellation and postMessage failures settle pending jobs and terminate once", async () => {
  for (const mode of ["cancel", "error", "postError", "loadError", "messageError"]) {
    let terminated = 0;
    const fake = { postMessage() { if (mode === "postError") throw new Error("clone failed"); }, terminate() { terminated++; } };
    const worker = new GIFWorker(() => fake);
    const pending = worker.send({ type: "init" });
    if (mode === "cancel") worker.dispose();
    if (mode === "error") fake.onmessage({ data: { type: "error", message: "encoder failed" } });
    if (mode === "loadError") fake.onerror({ preventDefault() {} });
    if (mode === "messageError") fake.onmessageerror();
    await assert.rejects(pending); worker.dispose(); assert.equal(terminated, 1);
    await assert.rejects(worker.send({ type: "finish" }));
  }
});

test("real encoder rejects incompressible output at the file budget", () => {
  const rgba = new Uint8Array(720 * 720 * 4);
  let seed = 29;
  for (let i = 0; i < rgba.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    rgba[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  const codec = createGIFCodec(720, 720);
  assert.throws(() => { for (let i = 0; i < 90; i++) codec.frame(rgba); }, { message: "GIF_TOO_LARGE" });
});

test("cancelled GIF initialization and encoding release canvas and worker without advancing the editor", async () => {
  const previous = globalThis.document;
  const canvases = [];
  const context = { setTransform() {}, fillRect() {}, fillText() {}, measureText: s => ({ width: s.length * 6 }), getImageData: () => ({ data: new Uint8ClampedArray(128 * 128 * 4) }) };
  globalThis.document = { createElement() { const canvas = { width: 0, height: 0, getContext: () => context, toBlob: cb => cb(new Blob(["poster"], { type: "image/png" })) }; canvases.push(canvas); return canvas; } };
  try {
    for (const stage of ["init", "frame"]) {
      const controller = new AbortController(); let terminated = 0, advances = 0;
      const capture = { data: { source: { attribution: "© OpenStreetMap contributors · ODbL" } }, advance() { advances++; }, render() {} };
      const worker = { terminate() { terminated++; }, postMessage(message) {
        if (message.type === stage) queueMicrotask(() => controller.abort());
        else queueMicrotask(() => worker.onmessage({ data: { type: "ready" } }));
      } };
      await assert.rejects(encodeCaptureGIF(capture, { width: 128, height: 128, view: { width: 128, height: 128 }, title: "test", signal: controller.signal }, () => worker), { name: "AbortError" });
      assert.equal(terminated, 1); assert.equal(advances, 0);
    }
    assert(canvases.every(c => c.width === 0 && c.height === 0));
  } finally { globalThis.document = previous; }
});
