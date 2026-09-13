import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = process.env.QA_OUTPUT ?? "artifacts/scenes", base = process.env.QA_URL ?? "http://127.0.0.1:5180/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const errors = [], results = [];
async function page(phone = false, lang = "en", player = false) {
  const p = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: "reduce", acceptDownloads: true });
  p.on("pageerror", e => errors.push(e.message));
  await p.route("**/src/main.js*", async r => { const response = await r.fetch(); await r.fulfill({ response, body: await response.text() + "\nwindow.__qa={snapshot:()=>engine.snapshot(),engine:()=>engine};" }); });
  await p.route("**/src/player/main.js*", async r => { const response = await r.fetch(); await r.fulfill({ response, body: await response.text() + "\nwindow.__playerQA={snapshot:()=>engine?.snapshot(),held:()=>held,running:()=>playback.running,raf:()=>raf};" }); });
  await p.goto(`${base}${player ? "player.html" : ""}?lang=${lang}${player ? "" : "#sapporo"}`);
  await p.waitForFunction(player ? () => !!window.__playerQA : () => !!window.__qa); return p;
}
const snapshot = p => p.evaluate(() => window.__qa.snapshot());
const playerState = p => p.evaluate(() => window.__playerQA.snapshot());
async function save(p, name) {
  await p.locator('#scene-menu').evaluate(e => e.open = true); await p.click("#share-scene"); const pending = p.waitForEvent("download"); await p.click("#download-scene"); const download = await pending;
  assert.equal(await download.failure(), null); await download.saveAs(`${output}/${name}.lumen.json`);
  const link = await p.locator("#scene-link").inputValue(); await p.screenshot({ path: `${output}/${name}-sharing.png` });
  await p.click("#close-scene"); await p.locator('#scene-menu').evaluate(e => e.open = false); return link;
}
try {
  for (const [phone, lang] of [[false, "en"], [true, "zh-TW"]]) {
    const p = await page(phone, lang), name = phone ? "phone" : "desktop";
    await p.click('[data-mood="blue"]'); await p.click("#adjust"); await p.locator("#density").fill("39"); await p.locator("#density").dispatchEvent("input"); await p.click("#close-adjust"); await p.click("#zoom-in");
    const before = await snapshot(p), link = await save(p, name); assert.deepEqual(await snapshot(p), before);
    const parsed = JSON.parse(await readFile(`${output}/${name}.lumen.json`, "utf8")); assert.deepEqual(parsed.recipe, before);
    await p.selectOption("#place-select", "tokyo"); await p.waitForFunction(() => window.__qa.snapshot().dataId === "tokyo");
    await p.setInputFiles("#import-scene", `${output}/${name}.lumen.json`); await p.waitForFunction(() => window.__qa.snapshot().dataId === "sapporo"); assert.deepEqual(await snapshot(p), before);
    assert.equal(await p.locator("#density").inputValue(), "39"); assert.equal(await p.locator('[data-mood="blue"]').getAttribute("aria-pressed"), "true");
    await p.screenshot({ path: `${output}/${name}-restored.png` });
    // Damaged data and impossible checkpoint edges keep the exact old scene.
    for (const mutate of [f => f.recipe.dataFingerprint = "0".repeat(64), f => f.recipe.checkpoint.cars[0].edge = 999999]) {
      const bad = structuredClone(parsed); mutate(bad); await p.setInputFiles("#import-scene", { name: "bad.lumen.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
      await p.locator("#retry-map").waitFor({ state: "visible" }); assert.deepEqual(await snapshot(p), before); await p.click("#cancel-map");
    }
    const viewer = await page(phone, lang, true); await viewer.goto(link); await viewer.waitForFunction(() => !!window.__playerQA?.snapshot());
    const ref = await playerState(viewer); assert.equal(ref.palette, before.palette); assert.equal(ref.density, before.density); assert(Math.abs(ref.simulationTime - 8) < 1e-8);
    assert.equal(await viewer.evaluate(() => window.__playerQA.running()), false); assert.equal(await viewer.evaluate(() => window.__playerQA.raf()), 0);
    const paused = await playerState(viewer); await viewer.waitForTimeout(300); assert.deepEqual(await playerState(viewer), paused);
    await viewer.click("#language"); assert.deepEqual(await playerState(viewer), paused); await viewer.click("#language");
    await viewer.click("#play"); await viewer.waitForTimeout(350); await viewer.click("#play"); assert((await playerState(viewer)).simulationTime > 8);
    // New browser context with map requests blocked proves that the complete file is portable.
    await viewer.goto(`${base}player.html?lang=${lang}`); let sourceRequests = 0;
    await viewer.route("**/data/**", r => { sourceRequests++; return r.abort(); }); await viewer.route("**/api/**", r => { sourceRequests++; return r.abort(); });
    await viewer.setInputFiles("#scene-file", `${output}/${name}.lumen.json`); await viewer.waitForFunction(() => !!window.__playerQA?.snapshot());
    const recovered = await playerState(viewer); assert.deepEqual(recovered.checkpoint, before.checkpoint); assert.equal(sourceRequests, 0);
    await viewer.screenshot({ path: `${output}/${name}-player.png` }); assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const oldPlayer = await playerState(viewer); await viewer.setInputFiles("#scene-file", { name: "bad.lumen.json", mimeType: "application/json", buffer: Buffer.from('{"version":99}') });
    await viewer.locator("#retry-load").waitFor({ state: "visible" }); assert.deepEqual(await playerState(viewer), oldPlayer);
    await viewer.click("#language"); assert.match(await viewer.locator("#player-status").textContent(), lang === "en" ? /無法/ : /could not/i);
    results.push({ phone, lang, fileBytes: (await readFile(`${output}/${name}.lumen.json`)).length, exactRestore: true, independentFileSourceRequests: sourceRequests, link });
    await p.close(); await viewer.close();
  }
  // Real iframe intersection changes; no parent messaging or same-origin helper is used by the player.
  const p = await page(), link = results[0].link;
  await p.route("**/embed-test.html", r => r.fulfill({ contentType: "text/html", body: `<html><body style="margin:0"><iframe src="${link}" width="900" height="500"></iframe><div style="height:2000px"></div></body></html>` }));
  await p.goto(`${base}embed-test.html`); const f = p.frames().find(f => f.url().includes("player.html"));
  await f.waitForFunction(() => !!window.__playerQA?.snapshot()); await f.click("#play"); await f.waitForTimeout(250);
  assert.equal(await f.evaluate(() => window.__playerQA.running()), true);
  await p.evaluate(() => scrollTo(0, 1100)); await f.waitForFunction(() => !window.__playerQA.running());
  const hidden = await f.evaluate(() => window.__playerQA.snapshot()); await p.waitForTimeout(400);
  assert.deepEqual(await f.evaluate(() => window.__playerQA.snapshot()), hidden); assert.equal(await f.evaluate(() => window.__playerQA.raf()), 0);
  await p.evaluate(() => scrollTo(0, 0)); await f.waitForFunction(() => window.__playerQA.running()); await p.waitForTimeout(200); await f.click("#play");
  assert((await f.evaluate(() => window.__playerQA.snapshot())).simulationTime > hidden.simulationTime);
  await p.evaluate(() => scrollTo(0, 1100)); await p.waitForTimeout(150); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(150); assert.equal(await f.evaluate(() => window.__playerQA.running()), false);
  results.push({ iframeOffscreenStopped: true, manualPausePreserved: true }); await p.close();
  const slow = await page(false, "en", true), payload = await readFile(`${output}/desktop.lumen.json`);
  await slow.route("**/slow.lumen.json", async r => { await new Promise(r => setTimeout(r, 800)); await r.fulfill({ contentType: "application/json", body: payload }).catch(() => {}); });
  await slow.goto(`${base}player.html?scene=slow.lumen.json`); await slow.locator("#cancel-load").waitFor({state:"visible"}); await slow.click("#cancel-load");
  await slow.locator("#retry-load").waitFor({state:"visible"}); assert.equal(await playerState(slow), undefined);
  await slow.setInputFiles("#scene-file", `${output}/phone.lumen.json`); await slow.waitForFunction(() => !!window.__playerQA?.snapshot());
  const latest = await playerState(slow); await slow.waitForTimeout(900); assert.deepEqual(await playerState(slow), latest);
  // Controlled visibility event tests the same handler that real background tabs use.
  await slow.click("#play"); await slow.waitForTimeout(150);
  await slow.evaluate(() => { Object.defineProperty(document, "hidden", {configurable:true,value:true}); document.dispatchEvent(new Event("visibilitychange")); });
  const background = await playerState(slow); await slow.waitForTimeout(250); assert.deepEqual(await playerState(slow), background); assert.equal(await slow.evaluate(()=>window.__playerQA.raf()),0);
  await slow.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); }); await slow.waitForTimeout(150); assert((await playerState(slow)).simulationTime>background.simulationTime);
  await slow.emulateMedia({reducedMotion:"no-preference"});
  // Let the first preference change reach the page before requesting the second.
  await slow.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await slow.emulateMedia({reducedMotion:"reduce"}); await slow.waitForFunction(()=>!window.__playerQA.running());
  results.push({ cancelledHostedLoadRecovered:true, latestFileWins:true, controlledVisibilityStops:true, dynamicReducedMotionStops:true }); await slow.close();
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
