import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import assert from "node:assert/strict";
const out = process.env.QA_OUTPUT || "artifacts/3d";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const report = { errors: [], console: [], requests: [] };
page.on("pageerror", (e) => report.errors.push(e.stack));
page.on("console", (e) => {
  if (["error", "warning"].includes(e.type()))
    report.console.push(e.text().slice(0, 800));
});
page.on("requestfailed", (r) =>
  report.requests.push({ url: r.url(), error: r.failure()?.errorText }),
);
try {
  await page.goto(
    (process.env.QA_URL || "http://127.0.0.1:5183/") + "three.html?debug=1",
  );
  await page.waitForFunction(
    () => window.__lumen3d?.stream?.ready && window.__lumen3d?.layer.mesh,
    null,
    { timeout: 45000 },
  );
  await page.waitForTimeout(3500);
  report.state = await page.evaluate(() => {
    const app = window.__lumen3d;
    return {
      status: document.querySelector("#status").textContent,
      stats: app?.layer.stats,
      webgl: app?.map?.getCanvas().getContext("webgl2")?.getParameter(7937),
      busy: app?.stream?.busy,
      ready: app?.stream?.ready,
      tiles: app?.map?.querySourceFeatures("world", { sourceLayer: "building" })
        .length,
    };
  });
  await page.screenshot({ path: `${out}/shanghai.png` });
  assert.ok(report.state.stats.buildings > 100);
  // 16 extra bytes per detailed vertex describe physical facade bounds/type.
  assert.ok(report.state.stats.geometryMiB < 46);
  await page.evaluate(() => {
    window.__lumen3d.layer.playing = false;
  });
  await page.locator("#tab-capture").click();
  await page.waitForFunction(() => window.__lumen3d.stream.ready && !window.__lumen3d.stream.busy);
  const before = await page.evaluate(() =>
    JSON.stringify(window.__lumen3d.layer.traffic.snapshot()),
  );
  const capture = async (format) => {
    await page.locator("#format").selectOption(format);
    const event = page.waitForEvent("download", { timeout: 180000 });
    await page.locator("#save").click();
    const file = await event;
    const path = `${out}/export.${file.suggestedFilename().split(".").at(-1)}`;
    await file.saveAs(path);
    await page.locator("#export-progress").waitFor({ state: "hidden" });
    return path;
  };
  await capture("png");
  await capture("gif");
  const videoPath = await capture("video");
  const input = new Input({
    source: new BufferSource(await readFile(videoPath)),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  report.video = {
    duration: await input.computeDuration(),
    ...(await track.computePacketStats()),
    codec: track.codec,
  };
  assert.equal(report.video.duration, 30);
  assert.equal(report.video.packetCount, 900);
  assert.equal(report.video.averagePacketRate, 30);
  input.dispose();
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(window.__lumen3d.layer.traffic.snapshot()),
    ),
    before,
    "Exports must restore the exact traffic checkpoint",
  );
  report.exports = ["png", "gif", "video"];
  await page.locator("#close-panel").click();
  const baseline = await page.evaluate(
    () => window.__lumen3d.layer.renderer.info.memory.geometries,
  );
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ bearing: 120, pitch: 57 });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/rotated.png` });
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({
      center: [-0.1246, 51.5007],
      zoom: 15.5,
      bearing: -15,
      pitch: 38,
    });
  });
  await page.waitForFunction(
    () =>
      window.__lumen3d.layer.origin[0] < 0 &&
      window.__lumen3d.stream.ready &&
      window.__lumen3d.layer.stats.buildings > 0,
    null,
    { timeout: 45000 },
  );
  report.global = await page.evaluate(() => ({
    ...window.__lumen3d.layer.stats,
    origin: window.__lumen3d.layer.origin,
    geometries: window.__lumen3d.layer.renderer.info.memory.geometries,
  }));
  assert.ok(report.global.buildings > 0);
  assert.ok(report.global.geometries <= baseline + 2);
  await page.screenshot({ path: `${out}/london.png` });
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ zoom: 11 });
  });
  await page.waitForFunction(() => !window.__lumen3d.layer.mesh);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/atlas.png` });
  report.far = await page.evaluate(() => ({
    mesh: !!window.__lumen3d.layer.mesh,
    cars: window.__lumen3d.layer.traffic?.cars.length || 0,
  }));
  assert.equal(report.far.cars, 0);
  await page.locator("#language").click();
  await page.locator("#tab-explore").click();
  await page.getByRole("button", { name: "台北・信義", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__lumen3d.layer.origin[0] > 121 &&
      window.__lumen3d.layer.origin[0] < 122 &&
      window.__lumen3d.stream.ready,
    null,
    { timeout: 45000 },
  );
  await page.locator("#close-panel").click();
  await page.screenshot({ path: `${out}/taipei-zh.png` });
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  phone.on("pageerror", (e) => report.errors.push(e.stack));
  await phone.goto(
    (process.env.QA_URL || "http://127.0.0.1:5183/") + "three.html?lang=zh-TW",
  );
  await phone.waitForFunction(() => window.__lumen3d?.stream?.ready, null, {
    timeout: 45000,
  });
  report.mobile = await phone.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    stats: window.__lumen3d.layer.stats,
    pixelRatio: window.__lumen3d.map.getPixelRatio(),
    canvas: [
      window.__lumen3d.map.getCanvas().width,
      window.__lumen3d.map.getCanvas().height,
    ],
  }));
  assert.equal(report.mobile.overflow, false);
  assert.ok(report.mobile.stats.triangles <= 280000 / 3);
  assert.ok(report.mobile.pixelRatio <= 1.25);
  await phone.screenshot({ path: `${out}/mobile-zh.png` });
  await phone.locator("#tab-light").click();
  await phone.screenshot({ path: `${out}/mobile-controls.png` });
  await phone.close();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.console, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
