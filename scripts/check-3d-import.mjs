import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.QA_OUTPUT || "artifacts/3d-import";
await mkdir(out, { recursive: true });
// A small original prism, exported as material-only GLB for the browser import test.
const vertices = new Float32Array([
  -1, 0, -1, 1, 0, -1, 1, 4, -1, -1, 0, -1, 1, 4, -1, -1, 4, -1, 1, 0, -1, 1, 0,
  1, 1, 4, 1, 1, 0, -1, 1, 4, 1, 1, 4, -1, 1, 0, 1, -1, 0, 1, -1, 4, 1, 1, 0, 1,
  -1, 4, 1, 1, 4, 1, -1, 0, 1, -1, 0, -1, -1, 4, -1, -1, 0, 1, -1, 4, -1, -1, 4,
  1, -1, 4, -1, 1, 4, -1, 1, 4, 1, -1, 4, -1, 1, 4, 1, -1, 4, 1,
]);
const doc = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
  materials: [
    { pbrMetallicRoughness: { baseColorFactor: [0.35, 0.55, 0.65, 1] } },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      type: "VEC3",
      count: vertices.length / 3,
      min: [-1, 0, -1],
      max: [1, 4, 1],
    },
  ],
  bufferViews: [{ buffer: 0, byteLength: vertices.byteLength }],
  buffers: [{ byteLength: vertices.byteLength }],
};
const json = JSON.stringify(doc),
  padded = Buffer.from(
    json + " ".repeat((4 - (Buffer.byteLength(json) % 4)) % 4),
  ),
  buffer = Buffer.alloc(28 + padded.length + vertices.byteLength);
[0x46546c67, 2, buffer.length, padded.length, 0x4e4f534a].forEach((v, i) =>
  buffer.writeUInt32LE(v, i * 4),
);
padded.copy(buffer, 20);
buffer.writeUInt32LE(vertices.byteLength, 20 + padded.length);
buffer.writeUInt32LE(0x004e4942, 24 + padded.length);
Buffer.from(vertices.buffer).copy(buffer, 28 + padded.length);
await writeFile(`${out}/prism.glb`, buffer);
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5180/three.html?city=sapporo");
  await page.waitForFunction(() => window.__lumen3d?.stream?.ready);
  await page.locator("#tab-models").click();
  await page.locator("#model-file").setInputFiles(`${out}/prism.glb`);
  await page.locator("#model-author").fill("Lumen Streets test fixture");
  await page.locator("#model-height").fill("120");
  await page.locator("#place-model").click();
  await page.waitForFunction(
    () => window.__lumen3d.layer.uploads.children.length === 1,
  );
  const imported = await page.evaluate(
    () => window.__lumen3d.layer.uploads.children[0].userData,
  );
  assert.equal(imported.height, 120);
  assert.equal(imported.triangles, 10);
  const event = page.waitForEvent("download");
  await page.locator("#model-manifest").click();
  await (await event).saveAs(`${out}/landmark.json`);
  await page.screenshot({ path: `${out}/import.png` });
  await page.locator("#remove-model").click();
  assert.equal(
    await page.evaluate(() => window.__lumen3d.layer.uploads.children.length),
    0,
  );
  await page
    .locator("#model-file")
    .setInputFiles({
      name: "invalid.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from("not a model"),
    });
  await page.locator("#place-model").click();
  await page.locator("#toast").filter({ hasText: "GLB" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__lumen3d.layer.uploads.children.length),
    0,
  );
  await page.locator("#close-panel").click();
  await page.evaluate(() => {
    window.__lumen3d.layer.playing = false;
  });
  const checkpoint = await page.evaluate(() =>
    JSON.stringify(window.__lumen3d.layer.traffic.snapshot()),
  );
  await page.locator("#tab-capture").click();
  await page.locator("#format").selectOption("gif");
  await page.locator("#save").click();
  await page.locator("#cancel-export").click();
  await page.locator("#export-progress").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(window.__lumen3d.layer.traffic.snapshot()),
    ),
    checkpoint,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      imported,
      removed: true,
      malformedRejected: true,
      cancelRestored: true,
      errors,
    }),
  );
} finally {
  await browser.close();
}
