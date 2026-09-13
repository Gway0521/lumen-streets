import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Run against the dev server with a separately installed Playwright.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.QA_URL ?? "http://127.0.0.1:5180/";
const output = process.env.QA_OUTPUT ?? "artifacts/exports";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"], ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const errors = [], results = { browser: browser.version(), exports: [], checks: [] };

async function setup(phone = false, lang = "en") {
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: "reduce", acceptDownloads: true });
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    const NativeWorker = Worker, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    window.__resources = { workers: 0, urls: 0, frames: [], heaps: [], roundTrips: [], failWorker: false };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.__resources.workers++; this.active = true; this.addEventListener("message", () => { if (this.sent) window.__resources.roundTrips.push(performance.now() - this.sent); }); }
      postMessage(...args) { if (window.__resources.failWorker) throw new Error("QA worker failure"); this.sent = performance.now(); return super.postMessage(...args); }
      terminate() { if (this.active) window.__resources.workers--; this.active = false; return super.terminate(); }
    };
    URL.createObjectURL = function (...args) { window.__resources.urls++; return create.apply(this, args); };
    URL.revokeObjectURL = function (...args) { window.__resources.urls--; return revoke.apply(this, args); };
    let last;
    function frame(now) {
      if (window.__resources.record && last) {
        window.__resources.frames.push(now - last);
        if (performance.memory) window.__resources.heaps.push(performance.memory.usedJSHeapSize);
      }
      last = now; requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.route("**/src/main.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `\nwindow.__sceneQA = { snapshot: () => engine.snapshot(), engine: () => engine, view: () => ({width,height,dpr,quietMode,locale}) };` });
  });
  await page.goto(`${base}?lang=${lang}#tokyo`);
  await page.locator("#loading").waitFor({ state: "hidden" });
  await page.waitForFunction(() => !!window.__sceneQA);
  return page;
}
const snapshot = page => page.evaluate(() => window.__sceneQA.snapshot());
async function options(page, format, size) {
  await page.click("#export-options");
  await page.selectOption("#capture-format", format);
  await page.selectOption("#capture-size", size);
}
async function resourcesReleased(page) {
  await page.waitForFunction(() => window.__resources.workers === 0 && window.__resources.urls === 0 && document.querySelector("#capture-preview").width === 0);
  assert.equal(await page.locator("#export-options").isEnabled(), true);
}
function gifInfo(b) {
  assert.equal(b.subarray(0, 6).toString(), "GIF89a");
  let p = 13 + 3 * (1 << ((b[10] & 7) + 1)), frames = 0, duration = 0;
  const blocks = () => { let n; while ((n = b[p++]) > 0) p += n; };
  while (p < b.length && b[p] !== 0x3b) {
    const type = b[p++];
    if (type === 0x21) { const label = b[p++]; if (label === 0xf9) duration += b.readUInt16LE(p + 2) * 10; blocks(); }
    else { assert.equal(type, 0x2c); frames++; assert.equal(b[p + 8] & 128, 0, "one global palette"); p += 10; blocks(); }
  }
  assert.equal(p, b.length - 1); assert.equal(b[p], 0x3b);
  assert.equal(frames, 90); assert.equal(duration, 6000);
  return { frames, duration };
}
async function generate(page, name, format, dimensions) {
  const start = Date.now();
  await page.evaluate(() => { Object.assign(window.__resources, { frames: [], heaps: [], roundTrips: [], record: true }); });
  await page.click("#create-export");
  await page.locator("#export-dialog").waitFor({ state: "visible", timeout: 90000 });
  const elapsed = Date.now() - start;
  await page.locator("#export-image").evaluate(img => img.decode());
  assert.deepEqual(await page.locator("#export-image").evaluate(img => [img.naturalWidth, img.naturalHeight]), dimensions);
  const metrics = await page.evaluate(() => {
    const r = window.__resources; r.record = false;
    const percentile = (a, q) => a.sort((a, b) => a - b)[Math.floor((a.length - 1) * q)] ?? 0;
    return { rafGapP95Ms: percentile(r.frames, .95), rafGapMaxMs: Math.max(0, ...r.frames), sampledMainHeapPeakMB: Math.max(0, ...r.heaps) / 1e6, workerRoundTripP95Ms: percentile(r.roundTrips, .95), workersAfter: r.workers };
  });
  assert.equal(metrics.workersAfter, 0);
  if (format === "gif") {
    assert.equal(await page.locator("#gif-preview-toggle").getAttribute("aria-pressed"), "false");
    const poster = await page.locator("#export-image").getAttribute("src");
    assert.notEqual(poster, await page.locator("#export-download").getAttribute("href"));
    const posterBytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector("#export-image").src)).arrayBuffer())));
    await writeFile(`${output}/${name}-poster.png`, Buffer.from(posterBytes));
    await page.click("#gif-preview-toggle");
    assert.equal(await page.locator("#export-image").getAttribute("src"), await page.locator("#export-download").getAttribute("href"));
    await page.click("#gif-preview-toggle");
    assert.equal(await page.locator("#export-image").getAttribute("src"), poster);
  }
  const button = await page.locator("#export-download").boundingBox(), viewport = page.viewportSize();
  assert(button.x >= 0 && button.x + button.width <= viewport.width && button.y + button.height <= viewport.height);
  await page.screenshot({ path: `${output}/${name}-result.png` });
  const pending = page.waitForEvent("download"); await page.click("#export-download");
  const file = await pending; assert.equal(await file.failure(), null);
  assert(file.suggestedFilename().endsWith(`.${format}`));
  await file.saveAs(`${output}/${name}.${format}`);
  const bytes = await readFile(`${output}/${name}.${format}`);
  let animation;
  if (format === "gif") { assert.deepEqual([bytes.readUInt16LE(6), bytes.readUInt16LE(8)], dimensions); animation = gifInfo(bytes); assert(bytes.length <= 25_000_000); }
  else { assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions); }
  results.exports.push({ name, dimensions, bytes: bytes.length, elapsedMs: elapsed, ...animation, ...metrics });
  console.log("Export verified:", name, elapsed, "ms", bytes.length, "bytes");
}
const closeResult = async page => { await page.click("#close-export"); await resourcesReleased(page); };
function controls(s) { const { simulationTime, remainder, checkpoint, ...rest } = s; return { ...rest, count: checkpoint.cars.length }; }
try {
  const page = await setup();
  await page.click("#zoom-in"); await page.locator("#city").press("ArrowRight");
  await page.click("#adjust"); await page.locator("#density").press("Home"); await page.locator("#density").press("ArrowRight"); await page.click("#close-adjust");
  const before = await snapshot(page);
  for (const [size, dims] of [["desktop", [3840, 2160]], ["portrait", [1080, 1920]]]) {
    await options(page, "png", size);
    await page.screenshot({ path: `${output}/${size}-settings.png` });
    // Independent render from the live checkpoint must exactly match the held capture.
    const reference = await page.evaluate(async size => {
      const { wallpaperPlan } = await import("/src/export/framing.ts"), { encodeCapturePNG } = await import("/src/export/png.ts");
      const live = window.__sceneQA.engine(), capture = live.fork();
      const plan = wallpaperPlan(window.__sceneQA.view(), live.data.geometry.bounds, live.camera, size, "png"); capture.setCamera(plan.camera);
      try { return Array.from(new Uint8Array(await (await encodeCapturePNG(capture, { ...plan, title: "Lumen Streets · Tokyo · Aerial gold", mode: "view" })).arrayBuffer())); }
      finally { capture.dispose(); }
    }, size);
    await writeFile(`${output}/${size}-reference.png`, Buffer.from(reference));
    await generate(page, size, "png", dims);
    assert.deepEqual(await snapshot(page), before); await closeResult(page);
  }
  for (const method of ["button", "escape", "failure"]) {
    await options(page, "gif", "desktop");
    if (method === "failure") await page.evaluate(() => { window.__resources.failWorker = true; });
    await page.click("#create-export");
    if (method !== "failure") {
      await page.waitForFunction(() => document.querySelector("#export-meter").value > .04);
      const start = Date.now();
      if (method === "button") await page.click("#cancel-export"); else await page.keyboard.press("Escape");
      await page.locator("#export-progress").waitFor({ state: "hidden" });
      results.checks.push(`${method} cancellation settled in ${Date.now() - start} ms`);
    } else {
      await page.locator("#export-progress").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#toast").isVisible(), true);
      await page.evaluate(() => { window.__resources.failWorker = false; });
    }
    assert.equal(await page.locator("#export-dialog").isVisible(), false);
    assert.deepEqual(await snapshot(page), before); await resourcesReleased(page);
  }
  await options(page, "gif", "desktop");
  await generate(page, "desktop-gif", "gif", [720, 405]);
  assert.deepEqual(await snapshot(page), before); await closeResult(page);
  await page.click("#play"); const liveBefore = await snapshot(page);
  await options(page, "gif", "current");
  await generate(page, "playing-current-gif", "gif", [720, 500]);
  const liveAfter = await snapshot(page); assert.deepEqual(controls(liveAfter), controls(liveBefore)); assert(liveAfter.simulationTime > liveBefore.simulationTime);
  results.checks.push(`GIF live playback continued ${liveBefore.simulationTime.toFixed(2)} -> ${liveAfter.simulationTime.toFixed(2)} s without changing controls`);
  await closeResult(page); await page.close();
  for (const lang of ["en", "zh-TW"]) {
    const phone = await setup(true, lang); const before = await snapshot(phone);
    await phone.screenshot({ path: `${output}/phone-${lang}.png` });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const [format, dims] of [["png", [1080, 1920]], ["gif", [405, 720]]]) {
      await options(phone, format, "portrait");
      await phone.screenshot({ path: `${output}/phone-${lang}-${format}-settings.png` });
      assert.equal(await phone.locator("#create-export").isEnabled(), true);
      await generate(phone, `phone-${lang}-${format}`, format, dims);
      assert.deepEqual(await snapshot(phone), before); await closeResult(phone);
    }
    await phone.close();
  }
  results.checks.push("Paused state exact after PNG/GIF/cancel/failure; worker and Blob URLs released after every job; reduced-motion result starts as a static poster; download remains GIF");
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
