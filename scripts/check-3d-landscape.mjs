import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.QA_URL || "http://127.0.0.1:5183/";
const out = process.env.QA_OUTPUT || "artifacts/3d-landscape";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  report = { errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
try {
  await page.goto(base + "three.html?city=shanghai&playing=0");
  await page.waitForFunction(() => window.__lumen3d?.stream?.ready, null, {
    timeout: 90000,
  });
  report.vegetation = await page.evaluate(async () => {
    const { EnvironmentBuilder } = await import("/src/three/environment.js");
    const origin = [0, 0],
      bounds = [-0.003, -0.003, 0.003, 0.003];
    const poly = (x0, y0, x1, y1, kind) => ({
      properties: { class: kind },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
          ],
        ],
      },
    });
    const forest = poly(-0.003, -0.003, 0.003, 0.003, "wood");
    const road = {
      properties: { class: "primary" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.003, 0],
          [0.003, 0],
        ],
      },
    };
    const lake = poly(0.0005, 0.0005, 0.002, 0.002, "water"),
      building = poly(-0.002, -0.002, -0.0005, -0.0005);
    const build = (reverse = false) => {
      const b = new EnvironmentBuilder(origin, bounds, false);
      if (!reverse) b.consume({ landcover: [forest] });
      b.addRoad(road);
      b.addPolygon(lake, "water");
      b.excludeBuilding(building);
      if (reverse) b.consume({ landcover: [forest] });
      return b.finish();
    };
    const a = build(),
      b = build(true),
      trees = Array.from(a.trees),
      inside = (x, y, p) => x > p[0] && x < p[2] && y > p[1] && y < p[3];
    const violations = [];
    for (let i = 0; i < trees.length; i += 5) {
      const [x, y, , r] = trees.slice(i, i + 5);
      if (
        Math.abs(y) < 12.5 + r ||
        inside(x, y, [55, -223, 223, -55]) ||
        inside(x, y, [-223, 55, -55, 223])
      )
        violations.push([x, y]);
    }
    const grass = new EnvironmentBuilder(origin, bounds, false);
    grass.consume({
      park: [poly(-0.003, -0.003, 0.003, 0.003, "park")],
      landcover: [poly(-0.003, -0.003, 0.003, 0.003, "grass")],
    });
    const g = grass.finish();
    const answer = {
      count: trees.length / 5,
      violations,
      orderIndependent:
        JSON.stringify(trees) === JSON.stringify(Array.from(b.trees)),
      grassTrees: g.trees.length / 5,
    };
    a.light.close();
    b.light.close();
    g.light.close();
    return answer;
  });
  assert.ok(report.vegetation.count > 100 && report.vegetation.count <= 6000);
  assert.deepEqual(report.vegetation.violations, []);
  assert.equal(report.vegetation.orderIndependent, true);
  assert.equal(report.vegetation.grassTrees, 0);
  const target = [139.773, 35.698];
  await page.route("**/api/search", (r) =>
    r.fulfill({
      json: {
        results: [
          { name: "Akihabara", context: "Tokyo, Japan", center: target },
        ],
      },
    }),
  );
  await page.locator('[data-tab="explore"]').click();
  await page.locator("#search-input").fill("akihabara");
  await page.locator("#search-form").evaluate((e) => e.requestSubmit());
  await page.locator("#search-results button").first().click();
  await page.waitForFunction(([x, y]) => {
    const c = __lumen3d.map.getCenter();
    return Math.abs(c.lng - x) < 0.00001 && Math.abs(c.lat - y) < 0.00001;
  }, target);
  report.search = await page.evaluate(() => ({
    center: __lumen3d.map.getCenter().toArray(),
    panelHidden: document.querySelector('[data-panel="explore"]').hidden,
  }));
  assert.equal(report.search.panelHidden, true);
  // A nearby result uses flyTo, which must also survive closing the panel.
  target[0] += 0.005;
  await page.locator('[data-tab="explore"]').click();
  await page.locator("#search-input").fill("nearby");
  await page.locator("#search-form").evaluate((e) => e.requestSubmit());
  await page.locator("#search-results button").first().click();
  await page.waitForFunction(([x, y]) => {
    const c = __lumen3d.map.getCenter();
    return (
      !__lumen3d.map.isMoving() &&
      Math.abs(c.lng - x) < 0.00001 &&
      Math.abs(c.lat - y) < 0.00001
    );
  }, target);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(out + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
