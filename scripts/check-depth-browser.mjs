import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const kind = process.env.QA_BROWSER || 'chromium', out = process.env.QA_OUTPUT || 'artifacts/depth';
await mkdir(out, { recursive: true });
const browser = await pw[kind].launch({ headless: true, ...(kind === 'chromium' ? { channel: process.env.BROWSER_CHANNEL || 'msedge' } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], report = { browser: browser.version(), checks: [] };
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:5180/');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  report.pixels = await page.evaluate(async () => {
    const { renderAerial } = await import('/src/aerial.js');
    const { createFramePainter } = await import('/src/engine/frame.js');
    const building = { id: 19, tags: { building: 'office', height: '50' }, points: [[40, 60], [100, 60], [100, 120], [40, 120], [40, 60]], holes: [] };
    const city = { bounds: [0, 0, 160, 160], buildings: [building], roads: [], land: [] };
    const first = renderAerial(city), second = renderAerial(city);
    if (first.foreground.toDataURL() !== second.foreground.toDataURL()) throw Error('Non-deterministic structures');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const edge = { points: [[0, 50], [160, 50]], cumulative: [0, 160], length: 160, lane: 0 };
    const car = { id: 1, edge, s: 60, age: 5, length: 6 };
    const state = { city, atlas: first, traffic: { graph: { signals: [] }, cars: [], time: 8 }, camera: { x: 0, y: 0, zoom: 1 }, mood: 'aerial' };
    const view = { width: 160, height: 160, origin: [0, 0], labels: false, vignette: false };
    const painter = createFramePainter();
    const patch = (x, y) => [...c.getImageData(x, y, 12, 5).data];
    painter.render(c, state, view); const without = patch(56, 48);
    state.traffic.cars = [car]; painter.render(c, state, view); const hidden = patch(56, 48);
    const occlusionDelta = Math.max(...without.map((value, i) => Math.abs(value - hidden[i])));
    if (occlusionDelta > 2) throw Error('Traffic painted through a roof');
    car.s = 132; painter.render(c, state, view); const exposed = patch(128, 48);
    state.traffic.cars = []; painter.render(c, state, view);
    if (JSON.stringify(exposed) === JSON.stringify(patch(128, 48))) throw Error('Exposed traffic disappeared');
    // A large courtyard stays transparent at its centre; it is not a filled tower.
    building.holes = [[[55, 75], [85, 75], [85, 105], [55, 105], [55, 75]]];
    building.tags.height = '8'; const courtyard = renderAerial(city);
    const alpha = courtyard.foreground.getContext('2d').getImageData(Math.round(70 * courtyard.resolution), Math.round(90 * courtyard.resolution), 1, 1).data[3];
    if (alpha !== 0) throw Error('Courtyard filled by extrusion');
    // Force only the frame painter down the no-filter path, including fractional edge alpha.
    const context = new Proxy(c, { has: (target, key) => key === 'filter' ? false : key in target,
      get: (target, key) => typeof target[key] === 'function' ? target[key].bind(target) : target[key],
      set: (target, key, value) => { target[key] = value; return true; } });
    const fallback = createFramePainter();
    fallback.render(context, state, { ...view, brightness: .5 }); const dim = c.getImageData(60, 50, 1, 1).data[0];
    fallback.render(context, state, { ...view, brightness: 1.5 }); const bright = c.getImageData(60, 50, 1, 1).data[0];
    if (bright <= dim) throw Error('Foreground fallback brightness is stale');
    painter.dispose(); fallback.dispose();
    for (const atlas of [first, second, courtyard]) for (const surface of [atlas.canvas, atlas.foreground]) surface.width = surface.height = 0;
    return { deterministic: true, roofOcclusion: true, occlusionDelta, exposedTraffic: true, courtyardAlpha: alpha, fallback: { dim, bright } };
  });
  report.scenes = await page.evaluate(async () => {
    const { loadSceneData } = await import('/src/scene/data.ts');
    const { createRecipe } = await import('/src/scene/recipe.ts');
    const { SceneEngine } = await import('/src/engine/scene-engine.ts');
    const results = [];
    for (const id of ['sapporo', 'tokyo', 'shanghai']) {
      const data = await loadSceneData(id), recipe = createRecipe(data);
      recipe.playing = false; recipe.appearance.labels = false;
      const start = performance.now(), engine = new SceneEngine(data, recipe);
      const atlasMs = performance.now() - start;
      const canvas = document.createElement('canvas'); canvas.width = 840; canvas.height = 1500;
      const ctx = canvas.getContext('2d'); engine.setCamera({ x: 0, y: 80, zoom: .78 });
      engine.render(ctx, { width: 840, height: 1500, origin: [420, 750], quietMode: true });
      const image = canvas.toDataURL();
      const clone = engine.fork(); clone.render(ctx, { width: 840, height: 1500, origin: [420, 750], quietMode: true });
      if (image !== canvas.toDataURL()) throw Error('Capture structure atlas differs');
      clone.dispose();
      const frameStart = performance.now();
      for (let i = 0; i < 30; i++) { engine.advance(.05); engine.render(ctx, { width: 840, height: 1500, labels: false }); }
      results.push({ id, atlasMs, averageFrameMs: (performance.now() - frameStart) / 30, image });
      engine.dispose(); canvas.width = canvas.height = 0;
    }
    return results;
  });
  for (const scene of report.scenes) {
    await writeFile(`${out}/${scene.id}-portrait.png`, Buffer.from(scene.image.split(',')[1], 'base64')); delete scene.image;
  }
  assert.deepEqual(errors, []); report.errors = errors;
  report.checks.push('Seeded pixels, traffic occlusion, open courtyard, brightness fallback, independent capture layer, portrait renders');
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
