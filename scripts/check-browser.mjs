import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
// Use a separately installed Playwright; it is not a runtime dependency of the app.
const playwright = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : "playwright";
const { chromium } = await import(playwright);
const base = process.env.QA_URL ?? "http://127.0.0.1:5180/";
const output = process.env.QA_OUTPUT ?? "artifacts/browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Test-only instrumentation of the editor module; no debug API ships with the application.
await page.route("**/src/main.js*", async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      "\nwindow.__sceneQA = { snapshot: () => engine.snapshot(), save: savePNG, engine: () => engine, view: () => ({width,height,dpr,quietMode,locale}) };",
  });
});
const snapshot = () => page.evaluate(() => window.__sceneQA.snapshot());
const waitReady = async () => {
  await page.locator("#loading").waitFor({ state: "hidden" });
  await page.waitForFunction(() => !!window.__sceneQA);
};
async function download(name, expectedWidth, expectedHeight) {
  await page.locator("#export-dialog").waitFor({ state: "visible" });
  await page.locator("#export-image").evaluate((img) => img.decode());
  const dimensions = await page
    .locator("#export-image")
    .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  assert.deepEqual(dimensions, [expectedWidth, expectedHeight]);
  const pending = page.waitForEvent("download");
  await page.click("#export-download");
  const file = await pending;
  assert.match(file.suggestedFilename(), /^lumen-streets-.*\.png$/);
  assert.equal(await file.failure(), null);
  await file.saveAs(`${output}/${name}.png`);
  const bytes = await readFile(`${output}/${name}.png`);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), expectedWidth);
  assert.equal(bytes.readUInt32BE(20), expectedHeight);
  return bytes.length;
}
async function referenceFrame(page) {
  return page.evaluate(async () => {
    const { wallpaperPlan, screenDimensions } = await import("/src/export/framing.ts");
    const { paintCapture } = await import("/src/export/png.ts");
    const live = window.__sceneQA.engine(), capture = live.fork();
    const plan = wallpaperPlan(window.__sceneQA.view(), live.data.geometry.bounds, live.camera, "current", "png", 1080, screenDimensions(screen, devicePixelRatio), live.projection);
    const canvas = document.createElement("canvas"); canvas.width = plan.width; canvas.height = plan.height;
    try { capture.setCamera(plan.camera); paintCapture(capture, canvas, { ...plan, title: "Reference" }); return canvas.toDataURL(); }
    finally { capture.dispose(); canvas.width = canvas.height = 0; }
  });
}
function stable(recipe) {
  const { simulationTime, remainder, checkpoint, ...controls } = recipe;
  return { ...controls, vehicleCount: checkpoint.cars.length };
}
const result = {
  browser: browser.version(),
  presets: [],
  viewComparisons: [],
  checks: [],
};
try {
  for (const id of [
    "xinyi",
    "ntu",
    "tokyo",
    "sapporo",
    "shanghai",
    "beijing",
    "seattle",
    "washington",
  ]) {
    await page.goto(`${base}?qa=${id}#${id}`);
    await waitReady();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    await page.screenshot({ path: `${output}/${id}-desktop.png` });
    const before = await snapshot();
    await page.click("#about");
    await page.click("#save-study");
    const size = await download(`${id}-study`, 1600, 1600);
    assert.deepEqual(await snapshot(), before);
    result.presets.push({
      id,
      bytes: size,
      fingerprint: before.dataFingerprint,
      isolated: true,
    });
    console.log("Preset PNG and isolation:", id);
  }
  await page.goto(`${base}?qa=current#xinyi`);
  await waitReady();
  await page.click("#zoom-in");
  await page.locator("#city").press("ArrowRight");
  await page.click("#adjust");
  await page.locator("#density").press("Home");
  await page.locator("#density").press("ArrowRight");
  await page.click("#trains");
  await page.click("#underground"); await page.click("#close-adjust");
  const priorLocale = await snapshot();
  await page.evaluate(() => {
    window.localeMarker = true;
  });
  await page.click("#language");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-TW");
  assert.equal(await page.evaluate(() => window.localeMarker), true);
  assert.deepEqual(await snapshot(), priorLocale);
  await page.click("#language");
  assert.deepEqual(await snapshot(), priorLocale);
  result.checks.push(
    "English/Traditional Chinese toggles preserve camera, seed, controls and exact simulation",
  );
  const beforeView = await referenceFrame(page);
  await page.click('#export-options'); await page.selectOption('#capture-size', 'current'); await page.selectOption('#capture-format', 'png'); await page.click('#create-export');
  await download("desktop-current", 1440, 1000);
  const pixelMatch = await page.evaluate(async (before) => {
    const decode = async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height - 100).data;
    };
    const a = await decode(before),
      b = await decode(document.querySelector("#export-image").src);
    let different = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
    return different;
  }, beforeView);
  assert.equal(
    pixelMatch,
    0,
    "clean export matches an independent wallpaper capture",
  );
  assert.deepEqual(await snapshot(), priorLocale);
  result.viewComparisons.push({
    size: "1440x1000",
    differingChannelsAboveFooter: pixelMatch,
  });
  await page.click("#close-export");
  // Live playback must continue during a full-area simulation/export.
  await page.click("#play");
  const liveBefore = await snapshot();
  await page.click("#about");
  await page.click("#save-study");
  await download("playing-study", 1600, 1600);
  const liveAfter = await snapshot();
  assert.deepEqual(stable(liveAfter), stable(liveBefore));
  assert(liveAfter.simulationTime > liveBefore.simulationTime);
  result.checks.push(
    `Playback continued during study: ${liveBefore.simulationTime.toFixed(2)} -> ${liveAfter.simulationTime.toFixed(2)} seconds`,
  );
  await page.click("#close-export");
  if (await page.locator("#notes").isVisible()) await page.click("#close-notes");
  await page.click("#play");
  const failureBefore = await snapshot();
  await page.evaluate(async () => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
    try {
      await window.__sceneQA.save("view");
    } finally {
      HTMLCanvasElement.prototype.toBlob = original;
    }
  });
  assert.deepEqual(await snapshot(), failureBefore);
  assert.equal(await page.locator("#export-dialog").isVisible(), false);
  assert.equal(await page.locator("#toast").isVisible(), true);
  assert.equal(await page.locator("#export-options").isEnabled(), true);
  result.checks.push(
    "Actual browser encoder failure preserves live state and recovers controls",
  );
  const cancellation = await page.evaluate(async () => {
    const { exportPNG } = await import("/src/export/png.ts");
    const controller = new AbortController();
    const live = window.__sceneQA.engine(),
      before = JSON.stringify(live.snapshot());
    const job = exportPNG(live, {
      mode: "study",
      width: 1600,
      height: 1600,
      title: "Cancel test",
      view: { width: 1600, height: 1600 },
      signal: controller.signal,
    });
    controller.abort();
    try {
      await job;
      return false;
    } catch (error) {
      return (
        error.name === "AbortError" &&
        before === JSON.stringify(live.snapshot())
      );
    }
  });
  assert.equal(cancellation, true);
  result.checks.push("Actual browser cancellation preserves live state");
  // A phone-sized, touch-capable context at DPR 2 exercises the real portrait current-view download.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const phone = await mobile.newPage();
  await phone.route("**/src/main.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + "\nwindow.__sceneQA={engine:()=>engine,view:()=>({width,height,dpr,quietMode,locale})};" });
  });
  phone.on("pageerror", (error) => errors.push(error.message));
  for (const lang of ["en", "zh-TW"]) {
    await phone.goto(`${base}?lang=${lang}#shanghai`);
    await phone.locator("#loading").waitFor({ state: "hidden" });
    assert.equal(await phone.locator("html").getAttribute("lang"), lang);
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await phone.screenshot({ path: `${output}/mobile-${lang}.png` });
    await phone.tap("#zoom-in");
    const phoneFrame = await referenceFrame(phone);
    await phone.click('#export-options'); await phone.selectOption('#capture-size', 'current'); await phone.selectOption('#capture-format', 'png'); await phone.click('#create-export');
    await phone.locator("#export-dialog").waitFor({ state: "visible" });
    await phone.locator("#export-image").evaluate((img) => img.decode());
    const dimensions = await phone
      .locator("#export-image")
      .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
    assert.deepEqual(dimensions, [780, 1688]);
    const phoneDifference = await phone.evaluate(async (before) => {
      const pixels = async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height - 100).data;
      };
      const a = await pixels(before),
        b = await pixels(document.querySelector("#export-image").src);
      let difference = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) difference++;
      return difference;
    }, phoneFrame);
    assert.equal(phoneDifference, 0);
    result.viewComparisons.push({
      size: "780x1688",
      locale: lang,
      differingChannelsAboveFooter: phoneDifference,
    });
    const button = await phone.locator("#export-download").boundingBox();
    assert(
      button.x >= 0 &&
        button.x + button.width <= 390 &&
        button.y + button.height <= 844,
    );
    await phone.screenshot({ path: `${output}/mobile-export-${lang}.png` });
    const pending = phone.waitForEvent("download");
    await phone.tap("#export-download");
    const file = await pending;
    await file.saveAs(`${output}/mobile-current-${lang}.png`);
    assert.equal(await file.failure(), null);
    result.checks.push(
      `${lang} phone 390x844, touch, no overflow, actual 780x1688 PNG download`,
    );
  }
  await mobile.close();
  const recovery = await browser.newPage({ reducedMotion: "reduce" });
  await recovery.route("**/src/main.js*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        "\nwindow.__sceneQA = { snapshot: () => engine.snapshot() };",
    });
  });
  recovery.on("pageerror", (error) => errors.push(error.message));
  await recovery.route("**/data/xinyi-rail.json", (route) => route.abort());
  await recovery.goto(`${base}?qa=recovery#xinyi`);
  await recovery.locator("#loading").waitFor({ state: "hidden" });
  assert.match(
    await recovery.locator("#rail-info").textContent(),
    /unavailable/i,
  );
  await recovery.waitForFunction(() => !!window.__sceneQA);
  const priorState = await recovery.evaluate(() => window.__sceneQA.snapshot());
  await recovery.route("**/data/tokyo.json", (route) => route.abort());
  await recovery.selectOption("#place-select", "tokyo");
  await recovery.locator("#retry-map").waitFor({ state: "visible" });
  assert.equal(await recovery.locator("#place-select").inputValue(), "xinyi");
  assert.deepEqual(
    await recovery.evaluate(() => window.__sceneQA.snapshot()),
    priorState,
  );
  assert.equal(await recovery.locator("#map-load").isVisible(), true);
  await recovery.close();
  result.checks.push(
    "Missing rail falls back; failed map selection retains the current scene",
  );
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
