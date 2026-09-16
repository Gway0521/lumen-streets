import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { presets } from "../src/three/presets.js";
import { showcaseLandmarks } from "../src/three/showcase.js";
const base = process.env.QA_URL || "http://127.0.0.1:5180/";
const out = "artifacts/showcase/verified";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [],
  errors = [];
const ready = async (page) => {
  await page.waitForFunction(
    () => window.__lumen3d?.stream?.ready && !window.__lumen3d.stream.busy,
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(650);
};
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__labelText = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            window.__sharedText = text;
          },
        },
      });
      const paint = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (this.canvas.id === "composition-preview")
          window.__labelText.push(String(text));
        return paint.call(this, text, ...args);
      };
    });
    for (const id of Object.keys(presets)) {
      await page.goto(
        `${base}?city=${id}&playing=0&viewLabels=1&lang=${mobile ? "en" : "zh-TW"}`,
      );
      await ready(page);
      const state = await page.evaluate(() => ({
        stats: __lumen3d.layer.stats,
        labels: [...new Set(__labelText)],
        hidden: document.getElementById("composition-preview").hidden,
        zoom: __lumen3d.map.getZoom(),
      }));
      assert.ok(
        state.stats.landmarkCount >=
          (mobile ? 2 : showcaseLandmarks.filter((p) => p.city === id).length),
        id,
      );
      assert.equal(state.stats.landmarkOmitted, 0, id);
      assert.equal(state.hidden, false);
      assert.ok(state.labels.length > 0, id);
      await page.screenshot({
        path: `${out}/${id}-${mobile ? "mobile" : "desktop"}.png`,
      });
      results.push({ id, mobile, ...state });
      console.log(id, mobile ? "mobile" : "desktop", state.stats.landmarkCount);
    }
    // Paused scenes must repaint when toggling names, changing language or closing capture.
    await page.locator("#tab-light").click();
    assert.match(
      await page.locator("#tab-light").innerText(),
      mobile ? /Settings/ : /設定/,
    );
    await page.locator("#view-landmark-labels").uncheck();
    assert.equal(await page.locator("#composition-preview").isHidden(), true);
    await page.locator("#view-landmark-labels").check();
    assert.equal(await page.locator("#composition-preview").isVisible(), true);
    await page.locator("#language").click();
    await page.waitForTimeout(500);
    await page.locator("#tab-capture").click();
    await ready(page);
    assert.equal(await page.locator("#landmark-labels").isChecked(), false);
    await page.locator("#share").click();
    const shared = new URL(await page.evaluate(() => window.__sharedText));
    assert.equal(shared.searchParams.get("viewLabels"), "1");
    assert.equal(shared.searchParams.get("city"), "newyork");
    const sceneDownload = page.waitForEvent("download");
    await page.locator("details:has(#save-scene) summary").click();
    await page.locator("#save-scene").click();
    const download = await sceneDownload,
      saved = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(saved.viewLabels, true);
    assert.equal(saved.composition.landmarkLabels, false);
    await page.locator("#close-panel").click();
    assert.equal(await page.locator("#composition-preview").isVisible(), true);
    await page.locator("#tab-light").click();
    await page.locator("#view-landmark-labels").uncheck();
    await page.locator("#scene-file").setInputFiles({
      name: "test.lumen-view.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
    await ready(page);
    await page.locator("#close-panel").click();
    assert.equal(await page.locator("#view-landmark-labels").isChecked(), true);
    assert.equal(await page.locator("#composition-preview").isVisible(), true);
    // Global travel must release the entire showcase and not leave labels at old coordinates.
    await page.evaluate(() => {
      __lumen3d.map.jumpTo({ center: [2.35, 48.86], zoom: 14.5 });
    });
    await page.waitForFunction(
      () => Math.abs(__lumen3d.layer.origin[0] - 2.35) < 0.01,
      null,
      { timeout: 90000 },
    );
    await ready(page);
    assert.equal(
      await page.evaluate(() => __lumen3d.layer.stats.landmarkCount),
      0,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
