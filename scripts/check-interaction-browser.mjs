import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.paints = 0;
      const original = CanvasRenderingContext2D.prototype.setTransform;
      CanvasRenderingContext2D.prototype.setTransform = function(...args) {
        if (this.canvas.id === 'city') window.paints++;
        return original.apply(this, args);
      };
    });
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5180/');
    await page.waitForFunction(() => document.querySelector('#loading').hidden);
    const snapshot = async () => {
      await page.locator('#scene-menu').evaluate(e => e.open = true); await page.click('#share-scene');
      const data = await page.evaluate(async () => (await fetch(document.querySelector('#download-scene').href)).json());
      await page.click('#close-scene'); await page.locator('#scene-menu').evaluate(e => e.open = false);
      return data.recipe;
    };
    const before = await snapshot();
    const burst = await page.evaluate(async () => {
      window.paints = 0;
      const canvas = document.querySelector('#city');
      for (let i = 0; i < 12; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -5, clientX: 200, clientY: 250, cancelable: true }));
      const immediate = window.paints;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { immediate, settled: window.paints };
    });
    assert.equal(burst.immediate, 0, 'Input must not synchronously repaint each event');
    assert.equal(burst.settled, 1, 'A burst must share one paint');
    const after = await snapshot();
    assert(Math.abs(after.camera.zoom / before.camera.zoom - Math.exp(0.06)) < 1e-8, 'Every wheel delta must be retained');
    assert.deepEqual(after.checkpoint, before.checkpoint, 'Paused gestures must preserve traffic');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.paints), 1, 'Paused interaction must return to idle');
    await page.click('#play');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
    assert(await page.evaluate(() => window.paints > 1));
    await page.click('#language');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log(`${mobile ? 'Touch viewport' : 'Desktop'}: one paint for 12 events, all camera deltas retained, paused traffic unchanged, idle/playback and bilingual layout passed.`);
    await context.close();
  }
} finally { await browser.close(); }
