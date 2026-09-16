import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Run against the default global service. No regional manifest or data mocks.
const out = process.env.QA_OUTPUT || "artifacts/3d-heights";
const center = (process.env.QA_HEIGHT_CENTER || "120.3002,22.6114").split(",").map(Number);
const base = process.env.QA_URL || "http://127.0.0.1:5180/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? {width:390,height:844} : {width:1440,height:1000},
      deviceScaleFactor:1, isMobile:mobile, hasTouch:mobile });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}?debug=1&lng=${center[0]}&lat=${center[1]}&zoom=15&pitch=45`);
    await page.waitForFunction(() => window.__lumen3d?.stream?.ready && !window.__lumen3d.stream.busy,
      null, {timeout:120000});
    const stats = await page.evaluate(() => window.__lumen3d.layer.stats);
    assert.ok(stats.buildings > 100);
    await page.waitForTimeout(800);
    assert.equal(stats.preparedTiles, stats.tiles, "Every loaded tile must use the global pipeline");
    assert.equal(stats.heightSummary["upstream-unknown"], undefined);
    assert.ok(stats.heightSummary.survey > 0 || stats.heightSummary.mapped > 0);
    assert.ok(stats.tileCacheMiB <= (mobile ? 8 : 24));
    assert.equal(await page.locator("#building-sources").isVisible(), true);
    await page.locator("#building-sources summary").click();
    assert.match(await page.locator("#building-sources p").first().textContent(), /Overture|PLATEAU|EUBUCCO|OpenStreetMap/);
    for (const locale of ["en", "zh-TW"]) {
      const label = locale === "en" ? "Building sources" : "建築資料來源";
      if ((await page.locator("#building-sources summary").textContent()) !== label)
        await page.locator("#language").click();
      assert.equal(await page.locator("#building-sources summary").textContent(), label);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({path:`${out}/${mobile?"mobile":"desktop"}-${locale}.png`});
    }
    await page.locator("#building-sources summary").click();
    await page.locator("#tab-capture").click();
    await page.waitForFunction(() => window.__lumen3d.stream.ready && !window.__lumen3d.stream.busy);
    await page.locator("#format").selectOption("png");
    const downloaded = page.waitForEvent("download", {timeout:120000});
    await page.locator("#save").click();
    await (await downloaded).saveAs(`${out}/${mobile?"mobile":"desktop"}-export.png`);
    await page.locator("#export-progress").waitFor({state:"hidden"});
    await page.locator("#close-panel").click();
    await page.evaluate(() => { window.__lumen3d.map.jumpTo({center:[36.82,-1.286],zoom:15.5}); });
    await page.waitForFunction(() => window.__lumen3d.stream.ready && !window.__lumen3d.stream.busy &&
      Math.abs(window.__lumen3d.layer.origin[0] - 36.82) < .01 && window.__lumen3d.layer.stats.preparedTiles > 0, null, {timeout:120000});
    assert.equal(await page.locator("#building-sources").isVisible(), true);
    const globalStats = await page.evaluate(() => window.__lumen3d.layer.stats);
    assert.equal(globalStats.preparedTiles, globalStats.tiles);
    assert.equal(globalStats.heightSummary["upstream-unknown"], undefined);
    await page.evaluate(() => { window.__lumen3d.map.jumpTo({zoom:10}); });
    await page.waitForFunction(() => !window.__lumen3d.layer.mesh);
    assert.deepEqual(errors, []);
    report.push({mobile,stats,globalStats,errors,checks:["prepared-data","credits","en","zh-TW","PNG","automatic-africa","atlas-disposal"]});
    await page.close();
  }
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
