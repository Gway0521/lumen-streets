import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.QA_OUTPUT || "artifacts/3d-capture";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ready = () =>
  page.waitForFunction(
    () => window.__lumen3d?.stream?.ready && !window.__lumen3d?.stream?.busy,
  );
const report = {};
try {
  await page.goto(
    (process.env.QA_URL || "http://127.0.0.1:5183/") +
      "?city=shanghai&lng=121.500&lat=31.240&zoom=15.5&bearing=-24&pitch=50&lang=zh-TW",
  );
  await ready();
  await page.evaluate(() => (__lumen3d.layer.playing = false));
  await page.locator("#tab-capture").click();
  await page.locator("#aspect").selectOption("9:20");
  await page.locator("[data-i18n=wallpaperOptions]").click();
  await page.locator("#place-label").check();
  await page.locator("#landmark-labels").check();
  await page.locator("#dim-side").selectOption("top");
  await page.locator("#title-corner").selectOption("top-left");
  await ready();
  await page.waitForTimeout(1200);
  const framing = () =>
    page.evaluate(() => {
      const m = __lumen3d.map,
        p = m.project([121.501, 31.24]);
      return {
        x: p.x / m.getCanvas().clientWidth,
        y: p.y / m.getCanvas().clientHeight,
        zoom: m.getZoom(),
        offset: m.lumenZoomOffset,
        center: m.getCenter().toArray(),
      };
    });
  const before = await framing();
  await page.locator("#compose-full").click();
  await page.locator("#finish-frame").click();
  await ready();
  const after = await framing();
  assert.ok(
    Math.abs(before.x - after.x) < 0.004 &&
      Math.abs(before.y - after.y) < 0.004,
  );
  report.framing = { before, after };
  const take = async (name) => {
    const event = page.waitForEvent("download", { timeout: 180000 });
    await page.locator("#save").click();
    const d = await event;
    await d.saveAs(`${out}/${name}`);
    await page.locator("#export-progress").waitFor({ state: "hidden" });
  };
  await take("portrait.png");
  report.png = await page.evaluate(
    async (data) => {
      const a = await fetch(data).then((r) => r.blob()),
        b = await createImageBitmap(a);
      return [b.width, b.height];
    },
    "data:image/png;base64," +
      (await readFile(out + "/portrait.png")).toString("base64"),
  );
  assert.deepEqual(report.png, [864, 1920]);
  await page.screenshot({ path: out + "/portrait-ui.png" });
  await page.locator("[data-i18n=sceneFiles]").click();
  const saved = page.waitForEvent("download");
  await page.locator("#save-scene").click();
  await (await saved).saveAs(out + "/scene.json");
  const scene = JSON.parse(await readFile(out + "/scene.json", "utf8"));
  await page.evaluate(() => {
    __lumen3d.map.jumpTo({ center: [121.49, 31.23] });
  });
  await ready();
  await page.locator("#scene-file").setInputFiles(out + "/scene.json");
  await ready();
  await page.waitForTimeout(1000);
  report.scene = await page.evaluate(async () => {
    const { trafficRecipe } = await import("/src/three/scene-recipe.js");
    return {
      time: __lumen3d.layer.time,
      cars: trafficRecipe(__lumen3d.layer.traffic),
      toast: document.querySelector("#toast").textContent,
    };
  });
  assert.equal(report.scene.time, scene.time);
  assert.deepEqual(report.scene.cars, scene.traffic);
  await page.locator("#format").selectOption("video");
  await page.locator("#duration").selectOption("300");
  await ready();
  const state = await page.evaluate(() => ({
    time: __lumen3d.layer.time,
    pixelRatio: __lumen3d.map.getPixelRatio(),
    traffic: JSON.stringify(__lumen3d.layer.traffic.snapshot()),
  }));
  await page.locator("#save").click();
  await page.locator("#export-progress").waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  await page.locator("#cancel-export").click();
  await page.locator("#export-progress").waitFor({ state: "hidden" });
  report.cancel = await page.evaluate(() => ({
    time: __lumen3d.layer.time,
    pixelRatio: __lumen3d.map.getPixelRatio(),
    traffic: JSON.stringify(__lumen3d.layer.traffic.snapshot()),
    capturing: __lumen3d.layer.capturing,
    locked: __lumen3d.stream.locked,
  }));
  assert.equal(report.cancel.traffic, state.traffic);
  assert.equal(report.cancel.pixelRatio, state.pixelRatio);
  assert.equal(report.cancel.capturing, false);
  assert.equal(report.cancel.locked, false);
  await page.locator("#close-panel").click();
  await page.locator("#tab-models").click();
  const glb = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { GLTFExporter } = await import(
      "/node_modules/three/examples/jsm/exporters/GLTFExporter.js"
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 3, 1),
      new THREE.MeshStandardMaterial({ color: 0xb6ac87 }),
    );
    const scene = new THREE.Scene();
    scene.add(mesh);
    const b = await new GLTFExporter().parseAsync(scene, { binary: true });
    return [...new Uint8Array(b)];
  });
  await writeFile(out + "/model.glb", Buffer.from(glb));
  await page.locator("#model-file").setInputFiles(out + "/model.glb");
  await page.locator("#model-name").fill("Test building");
  await page.locator("#model-author").fill("Test contributor");
  await page.locator("#place-model").click();
  await page.locator("#model-manifest").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector("#model-manifest").disabled,
  );
  await ready();
  const pkg = page.waitForEvent("download");
  await page.locator("#model-manifest").click();
  await (await pkg).saveAs(out + "/landmark.zip");
  await page.locator("#export-progress").waitFor({ state: "hidden" });
  await page.locator("#remove-model").click();
  assert.equal(
    await page.evaluate(() => __lumen3d.layer.uploads.children.length),
    0,
  );
  report.errors = errors;
  assert.deepEqual(errors, []);
  console.log(
    "ADVANCED PASS",
    JSON.stringify({
      ...report,
      scene: {
        time: report.scene.time,
        cars: report.scene.cars.cars.length,
        toast: report.scene.toast,
      },
      cancel: { ...report.cancel, traffic: "restored" },
    }),
  );
} finally {
  await writeFile(
    out + "/report.json",
    JSON.stringify({ ...report, errors }, null, 2),
  );
  await browser.close();
}
