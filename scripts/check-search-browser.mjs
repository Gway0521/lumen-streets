import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { selection } from "../src/search/area.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.QA_URL || "http://127.0.0.1:5180/";
const output = process.env.QA_OUTPUT || "artifacts/search-browser";
await mkdir(output, { recursive: true });
const raw = JSON.parse(await readFile(new URL("../public/data/xinyi.json", import.meta.url)));
delete raw.pocketPlaces;
const hash = raw => createHash("sha256").update(JSON.stringify(raw)).digest("hex");
// Mock map tiles: automated panning must not request public OSM tiles.
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#cbd1cc"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#e9e6dd" stroke-width="8"/></svg>';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const result = { browser: browser.version(), checks: [], downloads: [], errors: [] };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function setup(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true, ...options });
  const state = { searches: 0, maps: 0, error: null, railError: false, delay: 0 };
  page.on("pageerror", e => result.errors.push(e.message));
  await page.route("https://tile.openstreetmap.org/**", r => r.fulfill({ contentType: "image/svg+xml", body: tile }));
  await page.route("**/src/main.js*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + "\nwindow.__sceneQA={snapshot:()=>engine.snapshot(),data:()=>engine.data};" });
  });
  await page.route("**/api/search", async route => {
    state.searches++;
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { results: input.query === "none" ? [] : [
      { id: "N/1", name: "Test district", context: "Taipei, Taiwan", kind: "district", center: [121.5645, 25.0355] },
      { id: "N/2", name: "Test district", context: "Different city, Japan", kind: "district", center: [135, 35] },
      { id: "N/3", name: '<img src=x onerror="alert(1)">', context: "Literal map label", kind: "place", center: [121.5645, 25.0355] },
    ] } });
  });
  await page.route("**/api/map", async route => {
    state.maps++;
    const input = route.request().postDataJSON(), area = selection(input);
    const error = state.error || (input.rail && state.railError ? "quota" : null);
    const delay = state.delay;
    if (delay) await wait(delay);
    if (error) return route.fulfill({ status: error === "quota" ? 429 : 413, json: { error, retryAfter: 60 } }).catch(() => {});
    const data = input.rail ? { elements: [] } : raw;
    await route.fulfill({ json: { raw: data, area, sourceVersion: "overpass-area-v1", sourceURL: "https://overpass-api.de/api/interpreter", retrievedAt: "2026-09-12T00:00:00.000Z", fingerprint: hash(data), cache: "hit" } }).catch(() => {});
  });
  return { page, state };
}
async function ready(page, lang = "en") {
  await page.goto(`${base}?lang=${lang}`);
  await page.waitForFunction(() => !!window.__sceneQA);
  await page.locator("#find-place").waitFor({ state: "visible" });
}
async function choose(page, query = "Test district") {
  await page.click("#find-place");
  if (await page.locator("#change-place").isVisible()) await page.click("#change-place");
  await page.fill("#place-query", query);
  await page.locator("#search-form button").click();
  await page.locator("#search-results button").first().click();
}
const snap = page => page.evaluate(() => window.__sceneQA.snapshot());
async function download(page, name, dims) {
  await page.click('#export-options'); await page.selectOption('#capture-size', 'current'); await page.selectOption('#capture-format', 'png'); await page.click('#create-export');
  await page.locator("#export-dialog").waitFor({ state: "visible" });
  await page.locator("#export-image").evaluate(img => img.decode());
  assert.deepEqual(await page.locator("#export-image").evaluate(img => [img.naturalWidth, img.naturalHeight]), dims);
  const pending = page.waitForEvent("download"); await page.click("#export-download"); const file = await pending;
  await file.saveAs(`${output}/${name}.png`); assert.equal(await file.failure(), null);
  const bytes = await readFile(`${output}/${name}.png`);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  result.downloads.push({ name, bytes: bytes.length, dimensions: dims });
  await page.screenshot({ path: `${output}/${name}-dialog.png` });
  await page.click("#close-export");
}
try {
  const { page, state } = await setup(); await ready(page);
  await page.click("#find-place"); await page.fill("#place-query", "Test"); await wait(500);
  assert.equal(state.searches, 0, "typing must not query a provider");
  await page.locator("#search-form button").click(); await page.locator("#search-results button").first().waitFor();
  assert.equal(await page.locator("#search-results img").count(), 0);
  assert.match(await page.locator("#search-results").textContent(), /Different city/);
  await page.screenshot({ path: `${output}/desktop-search.png` });
  await page.locator("#search-results button").first().click();
  for (const size of [1, 4, 2]) { await page.click(`[data-area-size="${size}"]`); assert.match(await page.locator("#area-coordinates").textContent(), new RegExp(`${size} × ${size}`)); }
  const beforePan = await page.locator("#area-coordinates").textContent();
  await page.locator("#area-map").focus(); await page.keyboard.press("ArrowRight"); await wait(350);
  assert.notEqual(await page.locator("#area-coordinates").textContent(), beforePan);
  await page.screenshot({ path: `${output}/desktop-area.png` });
  await page.click("#generate-area");
  await page.waitForFunction(() => document.querySelector("#place-select").value.startsWith("area-"));
  const before = await snap(page); await download(page, "desktop-import", [1440, 1000]); assert.deepEqual(await snap(page), before);
  await page.click("#language"); assert.deepEqual(await snap(page), before); assert.match(await page.locator("#status").textContent(), /Test district/);
  await page.click("#language");
  result.checks.push("explicit submit; disambiguated safe text; 1/2/4 km; keyboard pan; imported PNG isolation; locale continuity");

  for (const code of ["tooDense", "quota", "partialData", "emptyArea", "timeout", "unavailable"]) {
    state.error = code; await choose(page); await page.click("#generate-area"); await page.locator("#retry-map").waitFor({ state: "visible" });
    assert.deepEqual(await snap(page), before); assert(await page.locator("#adjust-area").isVisible());
  }
  await page.screenshot({ path: `${output}/desktop-error.png` });
  state.error = null; await page.click("#retry-map"); await page.locator("#map-load").waitFor({ state: "hidden" });
  assert.match((await snap(page)).dataId, /^area-121\.\d+_25\.\d+-2$/);
  result.checks.push("six actionable failures preserve exact current scene; retry recovers");
  state.railError = true; await choose(page); await page.click("#generate-area"); await page.locator("#map-load").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__sceneQA.data().geometry.railUnavailable), true);
  state.railError = false;
  await choose(page); await page.click("#generate-area"); await page.locator("#map-load").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__sceneQA.data().geometry.railUnavailable), false);
  result.checks.push("optional rail failure preserves streets; same-area reload recovers rail");
  await page.click("#play"); const active = await snap(page);
  state.delay = 1200; await choose(page); await page.click("#generate-area"); await wait(500);
  assert((await snap(page)).simulationTime > active.simulationTime); await page.click("#cancel-map"); await wait(1500);
  assert.equal((await snap(page)).dataFingerprint, active.dataFingerprint);
  await choose(page); await page.click("#generate-area"); await page.selectOption("#place-select", "ntu");
  await page.waitForFunction(() => document.querySelector("#place-select").value === "ntu" && document.querySelector("#map-load").hidden); await wait(1500);
  assert.equal((await snap(page)).dataId, "ntu"); result.checks.push("live playback continues during import; cancellation; newest preset wins over stale load");
  await page.close();

  for (const lang of ["en", "zh-TW"]) {
    const { page: phone } = await setup({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ready(phone, lang); await phone.screenshot({ path: `${output}/phone-${lang}.png` });
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await choose(phone); await phone.click('[data-area-size="1"]');
    await phone.locator("#area-map").scrollIntoViewIfNeeded();
    const old = await phone.locator("#area-coordinates").textContent();
    // Chromium touch events exercise Leaflet's real touch panning path.
    const cdp = await phone.context().newCDPSession(phone), box = await phone.locator("#area-map").boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 40, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(500);
    assert.notEqual(await phone.locator("#area-coordinates").textContent(), old);
    await phone.screenshot({ path: `${output}/phone-area-${lang}.png` });
    await phone.click("#generate-area"); await phone.waitForFunction(() => document.querySelector("#place-select").value.startsWith("area-"));
    await phone.screenshot({ path: `${output}/phone-import-${lang}.png` });
    const before = await snap(phone); await download(phone, `phone-import-${lang}`, [702, 1519]); assert.deepEqual(await snap(phone), before);
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.close(); result.checks.push(`${lang}: 390×844 touch area pan, no overflow, actual 702×1519 PNG`);
  }
  assert.deepEqual(result.errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
