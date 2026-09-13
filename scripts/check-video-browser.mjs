import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = process.env.QA_OUTPUT ?? "artifacts/video", base = process.env.QA_URL ?? "http://127.0.0.1:5180/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"], ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const results = [], errors = [];
async function setup(phone, lang) {
  const p = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: "reduce", acceptDownloads: true });
  p.on("pageerror", e => errors.push(e.message));
  await p.addInitScript(() => {
    window.__encoders = []; window.__urls = 0;
    if (window.VideoEncoder) { const Native = VideoEncoder; window.VideoEncoder = class extends Native {
      constructor(...args) { super(...args); window.__encoders.push(this); }
      encode(...args) { if (window.__failEncode) throw new Error("QA encoder failure"); return super.encode(...args); }
    }; }
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = function (...a) { window.__urls++; return create.apply(this, a); };
    URL.revokeObjectURL = function (...a) { window.__urls--; return revoke.apply(this, a); };
  });
  await p.route("**/src/main.js*", async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + "\nwindow.__sceneQA={snapshot:()=>engine.snapshot(),engine:()=>engine};" }); });
  await p.goto(`${base}?lang=${lang}#sapporo`); await p.waitForFunction(() => !!window.__sceneQA); return p;
}
const snapshot = p => p.evaluate(() => window.__sceneQA.snapshot());
async function settings(p, format, seconds, size) {
  await p.click("#export-options"); await p.selectOption("#capture-format", format); await p.selectOption("#capture-size", size);
  if (seconds) await p.selectOption("#capture-duration", String(seconds));
  await p.waitForFunction(() => !document.querySelector("#create-export").disabled);
}
async function released(p) {
  await p.waitForFunction(() => !window.__urls && window.__encoders.every(e => e.state === "closed"));
  assert.equal(await p.locator("#export-options").isEnabled(), true);
}
async function download(p, name) {
  const pending = p.waitForEvent("download"); await p.click("#export-download"); const file = await pending;
  assert.equal(await file.failure(), null); await file.saveAs(`${output}/${name}`);
}
try {
  for (const [phone, lang, formats] of [[false, "en", [["mp4", 30], ["webm", 60]]], [true, "zh-TW", [["mp4", 60], ["webm", 30]]]]) {
    const p = await setup(phone, lang), size = phone ? "portrait" : "desktop", before = await snapshot(p);
    // Cropping changes only the capture, and preview pointer/keyboard controls remain usable.
    await settings(p, "png", 0, size); const frame0 = await p.locator("#capture-preview").evaluate(c => c.toDataURL());
    await p.click("#crop-in"); await p.locator("#capture-preview").press("ArrowDown");
    assert.notEqual(await p.locator("#capture-preview").evaluate(c => c.toDataURL()), frame0);
    const rect = await p.locator("#capture-preview").boundingBox();
    if (phone) { const cdp = await p.context().newCDPSession(p); await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x + rect.width / 2 + 20, y: rect.y + rect.height / 2 + 20 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    await p.click("#close-capture"); assert.deepEqual(await snapshot(p), before);
    await settings(p, "png", 0, size); await p.screenshot({ path: `${output}/${size}-clean-settings.png` });
    await p.click("#create-export"); await p.locator("#export-dialog").waitFor({ state: "visible" }); await download(p, `${size}-clean.png`);
    assert.equal(await p.locator("#export-source").isVisible(), true);
    const credits = p.waitForEvent("download"); await p.click("#export-credits"); const creditFile = await credits; await creditFile.saveAs(`${output}/${size}-credits.txt`);
    await p.click("#close-export"); await released(p);
    // Actual encoder cancellation and restart, in each viewport.
    await settings(p, "mp4", 60, size); await p.click("#create-export");
    await p.waitForFunction(() => document.querySelector("#export-meter").value > .025);
    const cancelled = Date.now(); await p.click("#cancel-export"); await p.locator("#export-progress").waitFor({ state: "hidden" });
    await released(p); assert.deepEqual(await snapshot(p), before);
    results.push({ size, cancelMs: Date.now() - cancelled });
    for (const [format, seconds] of formats) {
      await settings(p, format, seconds, size); await p.screenshot({ path: `${output}/${size}-${format}-settings.png` });
      const name = `${size}-${seconds}s.${format}`, start = Date.now();
      await p.evaluate(() => { window.__peak = 0; window.__heapTimer = setInterval(() => { if (performance.memory) window.__peak = Math.max(window.__peak, performance.memory.usedJSHeapSize); }, 100); });
      await p.click("#create-export"); await p.locator("#export-dialog").waitFor({ state: "visible", timeout: 180000 });
      const elapsedMs = Date.now() - start;
      const heap = await p.evaluate(() => { clearInterval(window.__heapTimer); return window.__peak; });
      await p.waitForFunction(() => document.querySelector("#export-video").readyState >= 2);
      const info = await p.locator("#export-video").evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, paused: v.paused }));
      assert.deepEqual([info.width, info.height], phone ? [1080, 1920] : [1920, 1080]); assert(Math.abs(info.duration - seconds) < .04); assert(info.paused);
      // Seek near the end, actually decode/play, then pause; never autoplay a reduced-motion result.
      await p.locator("#export-video").evaluate(v => { v.currentTime = v.duration - 1; });
      await p.waitForFunction(() => !document.querySelector("#export-video").seeking);
      await p.locator("#export-video").evaluate(v => v.play()); await p.waitForTimeout(250); await p.locator("#export-video").evaluate(v => v.pause());
      await download(p, name);
      const poster = await p.locator("#export-video").evaluate(async v => Array.from(new Uint8Array(await (await fetch(v.poster)).arrayBuffer())));
      await writeFile(`${output}/${name}-poster.png`, Buffer.from(poster));
      await p.screenshot({ path: `${output}/${size}-${format}-result.png` });
      assert.deepEqual(await snapshot(p), before);
      results.push({ name, ...info, elapsedMs, sampledMainHeapPeak: heap }); console.log("Verified video", name, elapsedMs, "ms");
      await p.click("#close-export"); await released(p);
    }
    await p.close();
  }
  const p = await setup(false, "en"), beforeFailure = await snapshot(p);
  await settings(p, "mp4", 30, "desktop"); await p.evaluate(() => { window.__failEncode = true; });
  await p.click("#create-export"); await p.locator("#export-progress").waitFor({ state: "hidden" });
  assert.equal(await p.locator("#export-dialog").isVisible(), false); await released(p); assert.deepEqual(await snapshot(p), beforeFailure);
  await p.evaluate(() => { window.__failEncode = false; });
  await p.click("#play"); const liveBefore = await snapshot(p);
  await settings(p, "webm", 30, "desktop"); await p.click("#create-export");
  await p.locator("#export-dialog").waitFor({ state: "visible", timeout: 180000 });
  const liveAfter = await snapshot(p);
  const controls = ({ simulationTime, remainder, checkpoint, ...rest }) => ({ ...rest, cars: checkpoint.cars.length });
  assert.deepEqual(controls(liveAfter), controls(liveBefore)); assert(liveAfter.simulationTime > liveBefore.simulationTime);
  await download(p, "playing-30s.webm"); await p.click("#close-export"); await released(p);
  results.push({ runtimeEncoderFailureRecovered: true, playingFrom: liveBefore.simulationTime, playingTo: liveAfter.simulationTime });
  // Capability failure has an actionable fallback, and asynchronous checks cannot enable stale UI.
  await p.close(); const unsupported = await setup(false, "en"); await unsupported.evaluate(() => { window.VideoEncoder = undefined; });
  await unsupported.click("#export-options"); await unsupported.selectOption("#capture-format", "mp4"); await unsupported.waitForFunction(() => document.querySelector("#video-support").textContent.includes("cannot"));
  assert.equal(await unsupported.locator("#create-export").isDisabled(), true); await unsupported.selectOption("#capture-format", "png"); assert.equal(await unsupported.locator("#create-export").isEnabled(), true); await unsupported.close();
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
