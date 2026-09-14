import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const out = process.env.QA_OUTPUT || "artifacts/3d-revision";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { errors: [], views: [], rotation: [] };
page.on("pageerror", (e) => report.errors.push(e.stack));
page.on("console", (e) => {
  if (e.type() === "error") report.errors.push(e.text());
});
const ready = async (p = page) => {
  await p.waitForFunction(
    () => window.__lumen3d?.stream?.ready && !window.__lumen3d.stream.busy,
    null,
    { timeout: 90000 },
  );
  await p.waitForTimeout(700);
};
const state = (p) =>
  p.evaluate(() => {
    const { map, layer } = window.__lumen3d;
    return {
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      stats: layer.stats,
      geometries: layer.renderer.info.memory.geometries,
      textures: layer.renderer.info.memory.textures,
    };
  });
try {
  await page.goto("http://127.0.0.1:5183/three.html?debug=1");
  await ready();
  report.views.push({ name: "default", ...(await state(page)) });
  await page.screenshot({ path: `${out}/default.png` });
  // Real mouse gestures at three vertical positions must produce the same bearing delta.
  for (const y of [220, 480, 740]) {
    await page.evaluate(() => {
      window.__lumen3d.map.jumpTo({ bearing: 0, pitch: 40 });
    });
    await page.mouse.move(440, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(640, y, { steps: 10 });
    const bearing = await page.evaluate(() =>
      window.__lumen3d.map.getBearing(),
    );
    await page.mouse.up({ button: "right" });
    await page.evaluate(() => {
      window.__lumen3d.map.stop();
    });
    report.rotation.push({ y, bearing });
    assert.ok(bearing > 35 && bearing < 60);
  }
  assert.ok(
    Math.max(...report.rotation.map((r) => r.bearing)) -
      Math.min(...report.rotation.map((r) => r.bearing)) <
      2,
  );
  for (const [name, zoom] of [
    ["near-limit", 18],
    ["aerial", 13.65],
    ["city-wide", 12.5],
  ]) {
    await page.evaluate((zoom) => {
      window.__lumen3d.map.jumpTo({ zoom, bearing: -8, pitch: 40 });
    }, zoom);
    await page.waitForTimeout(700);
    await ready();
    const current = await state(page);
    assert.ok(current.zoom <= 14.5);
    assert.ok(current.stats.buildings > 1000);
    assert.equal(current.stats.tileLimited, false);
    report.views.push({ name, ...current });
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({
      center: [141.3545, 43.0595],
      zoom: 12.8,
      pitch: 35,
    });
  });
  await page.waitForTimeout(700);
  await ready();
  report.views.push({ name: "sapporo-global", ...(await state(page)) });
  await page.screenshot({ path: `${out}/sapporo-global.png` });
  assert.ok(report.views.at(-1).stats.buildings > 1000);
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ zoom: 11 });
  });
  await page.waitForTimeout(900);
  assert.equal(
    await page.evaluate(
      () =>
        !!window.__lumen3d.layer.mesh ||
        !!window.__lumen3d.layer.distant ||
        !!window.__lumen3d.layer.surface,
    ),
    false,
  );
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  phone.on("pageerror", (e) => report.errors.push(e.stack));
  await phone.goto("http://127.0.0.1:5183/three.html?lang=zh-TW");
  await ready(phone);
  report.mobile = await state(phone);
  await phone.screenshot({ path: `${out}/mobile.png` });
  assert.equal(report.mobile.zoom, 13.35);
  assert.equal(report.mobile.stats.tileLimited, false);
  await phone.close();
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/aerial-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
