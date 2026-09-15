import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Run against Vite development server: the capture checks import the live module.
const base = process.env.QA_URL || "http://127.0.0.1:5183/";
const out = process.env.QA_OUTPUT || "artifacts/3d-art";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { errors: [], captures: [], revisits: [] };
const page = await browser.newPage({ viewport: { width: 1664, height: 936 } });
const observe = (p) => {
  p.on("pageerror", (e) => report.errors.push(e.stack));
  p.on("console", (e) => {
    if (e.type() === "error") report.errors.push(e.text());
  });
};
observe(page);
const ready = async (p) => {
  await p.waitForTimeout(650);
  await p.waitForFunction(
    () => {
      const app = window.__lumen3d;
      if (!app?.stream?.ready || app.stream.busy) return false;
      const b = app.map.getBounds(),
        key = app.stream.lastKey.split(":");
      return (
        key[1] ===
          [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
            .map((n) => n.toFixed(3))
            .join(",") && Number(key[2]) === Math.floor(app.map.getZoom() * 4)
      );
    },
    null,
    { timeout: 90000 },
  );
};
const state = (p) =>
  p.evaluate(() => {
    const { map, layer } = window.__lumen3d,
      gl = layer.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      zoom: map.getZoom(),
      ratio: map.getPixelRatio(),
      canvas: [map.getCanvas().width, map.getCanvas().height],
      stats: layer.stats,
      gpu: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      resources: { ...layer.renderer.info.memory },
      bloomBytes: layer.bloom.bytes,
      environmentBytes: layer.environment?.bytes || 0,
      glError: gl.getError(),
    };
  });
try {
  await page.goto(
    base +
      "three.html?city=sapporo&lng=141.3566&lat=43.0591&zoom=14.1&bearing=0&pitch=40&embed=1",
  );
  await ready(page);
  report.desktop = await state(page);
  await page.screenshot({ path: `${out}/after-sapporo.png` });
  report.pacing = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        const frame = () => {
          const t = performance.now();
          samples.push(t - last);
          last = t;
          if (samples.length >= 181) {
            window.__lumen3d.map.off("render", frame);
            samples.shift();
            samples.sort((a, b) => a - b);
            resolve({ medianMs: samples[90], p95Ms: samples[171] });
          }
        };
        window.__lumen3d.map.on("render", frame);
      }),
  );
  await page.evaluate(() => {
    window.__lumen3d.layer.playing = false;
  });
  for (const edge of [3840, 1920, 3840]) {
    const capture = await page.evaluate(async (edge) => {
      const { exportNight } = await import("/src/three/export.js");
      const app = window.__lumen3d;
      const before = {
        ratio: app.map.getPixelRatio(),
        time: app.layer.time,
        traffic: JSON.stringify(app.layer.traffic.snapshot()),
      };
      const output = await exportNight({
        ...app,
        format: "png",
        longEdge: edge,
      });
      const bitmap = await createImageBitmap(output.blob),
        size = [bitmap.width, bitmap.height];
      bitmap.close();
      return {
        size,
        bytes: output.blob.size,
        restored:
          before.ratio === app.map.getPixelRatio() &&
          before.time === app.layer.time &&
          before.traffic === JSON.stringify(app.layer.traffic.snapshot()),
      };
    }, edge);
    await page.waitForTimeout(250);
    capture.state = await state(page);
    report.captures.push(capture);
    assert.equal(Math.max(...capture.size), edge);
    assert.ok(capture.restored);
    assert.equal(capture.state.bloomBytes, report.desktop.bloomBytes);
    assert.equal(
      capture.state.resources.textures,
      report.desktop.resources.textures,
    );
    assert.equal(capture.state.glError, 0);
  }
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ bearing: 90 });
  });
  await ready(page);
  await page.screenshot({ path: `${out}/rotated-sapporo.png` });
  const direction = await page.evaluate(() =>
    window.__lumen3d.layer.environment.waterMaterial.uniforms.direction.value.toArray(),
  );
  assert.ok(Math.abs(direction[0] + 1) < 1e-6 && Math.abs(direction[1]) < 1e-6);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      window.__lumen3d.map.jumpTo({ zoom: 11 });
    });
    await page.waitForFunction(() => !window.__lumen3d.layer.mesh);
    const atlas = await state(page);
    assert.equal(atlas.bloomBytes, 0);
    assert.equal(atlas.environmentBytes, 0);
    await page.evaluate(() => {
      window.__lumen3d.map.jumpTo({ zoom: 14.1, bearing: 0 });
    });
    await ready(page);
    report.revisits.push(await state(page));
  }
  for (const visit of report.revisits) {
    assert.deepEqual(visit.resources, report.desktop.resources);
    assert.equal(visit.glError, 0);
  }
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ zoom: 14.5 });
  });
  report.zoomSteps = [];
  for (const expected of [15.5, 16.5, 16.5]) {
    await page.locator("#zoom-in").click();
    await page.waitForFunction(() => !window.__lumen3d.map.isMoving());
    const zoom = await page.evaluate(() => window.__lumen3d.map.getZoom());
    report.zoomSteps.push(zoom);
    assert.ok(Math.abs(zoom - expected) < 1e-6);
  }
  await ready(page);
  await page.screenshot({ path: `${out}/closest-sapporo.png` });
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  observe(phone);
  await phone.goto(base + "three.html?city=sapporo&lang=zh-TW");
  await ready(phone);
  report.mobile = await state(phone);
  assert.ok(report.mobile.ratio <= 1.25);
  assert.equal(report.mobile.glError, 0);
  await phone.screenshot({ path: `${out}/mobile-sapporo.png` });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/art-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
