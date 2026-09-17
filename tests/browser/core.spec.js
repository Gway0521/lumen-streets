import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ready = (page) => page.waitForFunction(() => window.__lumen3d?.stream?.ready && !window.__lumen3d.stream.busy);
const checkpoint = (page) => page.evaluate(() => ({
  time: __lumen3d.layer.time, traffic: JSON.stringify(__lumen3d.layer.traffic.snapshot()),
  ratio: __lumen3d.map.getPixelRatio(), center: __lumen3d.map.getCenter().toArray(),
}));
let failures;
test.beforeEach(async ({ context, request }) => {
  failures = [];
  await request.post("/fixtures/control", { data: {} });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["data:", "blob:"].includes(url.protocol) || url.origin === "http://127.0.0.1:5183") return route.continue();
    failures.push(url.href); return route.abort();
  });
  context.on("page", (page) => page.on("pageerror", (error) => failures.push(error.message)));
});
test.afterEach(() => expect(failures).toEqual([]));
const open = (page, testInfo) => page.goto(`/?city=shanghai&zoom=15.5&density=120&lang=${testInfo.project.name.endsWith("zh") ? "zh-TW" : "en"}`);

test("scene, PNG, restoration and cancellation", async ({ page }, testInfo) => {
  await open(page, testInfo); await ready(page);
  expect(await page.evaluate(() => __lumen3d.layer.stats.buildings)).toBeGreaterThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#tab-light").click();
  await page.locator("#play").click();
  await page.locator("#tab-capture").click(); await ready(page);
  const state = await checkpoint(page);
  const takePNG = async () => {
    await page.locator("#format").selectOption("png");
    const downloading = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await downloading;
    const path = testInfo.outputPath("capture.png"); await download.saveAs(path);
    await expect(page.locator("#export-progress")).toBeHidden();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20))).toBe(1920);
    const colors = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(96, 96), ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, 96, 96); bitmap.close();
      const pixels = ctx.getImageData(0, 0, 96, 96).data, colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      return colors.size;
    }, bytes.toString("base64"));
    expect(colors).toBeGreaterThan(100);
  };
  await takePNG();
  expect(await checkpoint(page)).toEqual(state);
  await page.locator("[data-i18n=sceneFiles]").click();
  const downloading = page.waitForEvent("download"); await page.locator("#save-scene").click();
  const scenePath = testInfo.outputPath("scene.json"); await (await downloading).saveAs(scenePath);
  const scene = JSON.parse(await readFile(scenePath, "utf8"));
  await page.evaluate(() => {
    __lumen3d.layer.advance(3);
    __lumen3d.map.jumpTo({ center: [121.488, 31.236] });
  }); await ready(page);
  expect((await checkpoint(page)).time).not.toBe(scene.time);
  await page.locator("#scene-file").setInputFiles(scenePath);
  await expect.poll(() => page.evaluate(() => __lumen3d.map.getCenter().toArray())).toEqual([scene.view.lng, scene.view.lat]);
  await ready(page);
  await expect.poll(() => page.evaluate(async () => (await import("/src/three/scene-recipe.js")).trafficRecipe(__lumen3d.layer.traffic))).toEqual(scene.traffic);
  const restored = await checkpoint(page);
  expect(restored.time).toBe(scene.time);
  await page.locator("#format").selectOption("gif");
  await page.locator("#save").click();
  await expect(page.locator("#export-progress")).toBeVisible();
  await page.waitForFunction(() => __lumen3d.layer.capturing);
  await page.locator("#cancel-export").click();
  await expect(page.locator("#export-progress")).toBeHidden();
  expect(await checkpoint(page)).toEqual(restored);
  expect(await page.evaluate(() => __lumen3d.stream.locked || __lumen3d.layer.capturing)).toBe(false);
  await takePNG();
});

test("transient building failure recovers at the same camera", async ({ page, request }, testInfo) => {
  await request.post("/fixtures/control", { data: { failures: 1 } });
  await open(page, testInfo); await ready(page);
  await expect(page.locator("#building-network")).toBeHidden();
  expect(await page.evaluate(() => __lumen3d.layer.stats.buildings)).toBeGreaterThan(10);
});

test("retry remains visible after the retry budget is exhausted", async ({ page, request }, testInfo) => {
  await request.post("/fixtures/control", { data: { failures: 999 } });
  await open(page, testInfo);
  await expect(page.locator("#retry-buildings")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("retry.png") });
  const state = await (await request.get("/fixtures/control")).json();
  expect(state.requests).toBe(3);
  const center = await page.evaluate(() => __lumen3d.map.getCenter().toArray());
  await request.post("/fixtures/control", { data: {} });
  await page.locator("#retry-buildings").click(); await ready(page);
  await expect(page.locator("#building-network")).toBeHidden();
  expect(await page.evaluate(() => __lumen3d.map.getCenter().toArray())).toEqual(center);
});

test("stalled response bodies time out and cancelled views recover", async ({ page, request }, testInfo) => {
  await open(page, testInfo); await ready(page);
  await request.post("/fixtures/control", { data: { stall: 30000, bodyStall: true } });
  const deadline = await page.evaluate(async () => {
    const { requestBytes } = await import("/src/three/request.js");
    let attempts = 0;
    try {
      await requestBytes("/api/buildings/manifest.json", { timeout: 100, retries: 1, delay: 1, onAttempt: () => attempts++ });
    } catch (error) { return { name: error.name, attempts }; }
  });
  expect(deadline).toEqual({ name: "TimeoutError", attempts: 2 });
  await page.evaluate(() => { __lumen3d.stream.refresh = true; __lumen3d.stream.retry(); __lumen3d.stream.build(); });
  await page.waitForFunction(() => __lumen3d.stream.busy);
  await request.post("/fixtures/control", { data: {} });
  const completed = await page.evaluate(() => __lumen3d.stream.metrics.completed);
  await page.evaluate(() => { __lumen3d.map.jumpTo({ center: [121.485, 31.235] }); });
  await page.waitForFunction(n => __lumen3d.stream.ready && !__lumen3d.stream.busy && __lumen3d.stream.metrics.completed > n, completed);
  expect(await page.evaluate(() => __lumen3d.stream.metrics.cancelled)).toBeGreaterThan(0);
  await expect(page.locator("#building-network")).toBeHidden();
});
