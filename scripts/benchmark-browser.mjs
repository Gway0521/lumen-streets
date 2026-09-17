import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { startFixtureServer } from "../tests/browser/server.mjs";

const external = process.env.BENCH_URL;
const baseURL = external || "http://127.0.0.1:5183/";
const seconds = Number(process.env.BENCH_SECONDS || 60);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) throw Error("BENCH_SECONDS must be between 5 and 3600");
if (process.env.BENCH_SCENE && !["shanghai", "xinyi", "sapporo"].includes(process.env.BENCH_SCENE)) throw Error("Unknown BENCH_SCENE");
const output = process.env.QA_OUTPUT || "artifacts/performance";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, headless: true });
let server;
const report = { mode: external ? "live providers" : "synthetic building fixtures; bundled snapshot roads/landmarks",
  browser: browser.version(), node: process.version, platform: process.platform, secondsPerScene: seconds,
  cpu: cpus()[0]?.model, systemMemoryGiB: totalmem() / 1073741824, viewport: { width: 1280, height: 900 },
  coldScope: "new browser context and worker; server caches are not purged", scenes: [] };
const scenes = [
  { name: "Shanghai waterfront", query: "city=shanghai&zoom=15.5", count: 4 },
  { name: "Taipei landmarks", query: "city=xinyi&zoom=15.5", count: 6 },
  { name: "Sapporo dense grid", query: "city=sapporo&zoom=15.5", count: 10 },
];
const ready = async (page) => {
  const handle = await page.waitForFunction(() => Boolean(__lumen3d?.stream?.ready && !__lumen3d.stream.busy && __lumen3d.layer.mesh), null, { timeout: 120000 });
  await handle.dispose();
};
const sample = (page) => page.evaluate(() => ({
  geometry: __lumen3d.layer.stats, stream: { ...__lumen3d.stream.metrics, busy: __lumen3d.stream.busy, pending: __lumen3d.stream.pending },
  heapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  geometries: __lumen3d.layer.renderer.info.memory.geometries,
  textures: __lumen3d.layer.renderer.info.memory.textures,
}));
try {
  server = external ? null : await startFixtureServer();
  for (const scene of scenes) {
    if (process.env.BENCH_SCENE && !scene.query.includes(`city=${process.env.BENCH_SCENE}&`)) continue;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const errors = [];
    if (!external) {
      await context.request.post(`${baseURL}fixtures/control`, { data: { count: scene.count } });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (["blob:", "data:"].includes(url.protocol) || url.origin === new URL(baseURL).origin) return route.continue();
        errors.push(`Unexpected network: ${url.href}`); return route.abort();
      });
    }
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    const retainedHeap = async () => {
      await session.send("HeapProfiler.collectGarbage");
      const heap = await session.send("Runtime.getHeapUsage");
      return { usedMiB: heap.usedSize / 1048576,
        backingStorageMiB: heap.backingStorageSize === undefined ? null : heap.backingStorageSize / 1048576 };
    };
    page.on("pageerror", e => errors.push(e.message));
    const start = performance.now();
    await page.goto(`${baseURL}?${scene.query}`); await ready(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const coldMs = performance.now() - start, initial = await sample(page);
    const warmStart = performance.now();
    await page.evaluate(() => { __lumen3d.stream.retry(); __lumen3d.stream.build(); }); await ready(page);
    const warmMs = performance.now() - warmStart, warm = await sample(page);
    const frameIntervals = await page.evaluate(() => new Promise(resolve => {
      const values = []; let last, start;
      function frame(time) {
        start ??= time;
        if (last !== undefined) values.push(time - last);
        last = time;
        if (time - start < 5000) requestAnimationFrame(frame); else resolve(values);
      }
      requestAnimationFrame(frame);
    }));
    frameIntervals.sort((a, b) => a - b);
    const retainedBefore = await retainedHeap();
    const memory = [], until = performance.now() + seconds * 1000;
    const center = await page.evaluate(() => __lumen3d.map.getCenter().toArray());
    let i = 0;
    while (performance.now() < until) {
      await page.evaluate(({ i, center }) => {
        __lumen3d.map.jumpTo({ bearing: (i % 8) * 45,
          center: [center[0] + Math.sin(i) * .003, center[1] + Math.cos(i) * .003] });
        __lumen3d.stream.build();
      }, { i: i++, center });
      await ready(page);
      memory.push({ elapsedMs: performance.now() - start, ...await sample(page) });
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: `${output}/${report.scenes.length + 1}.png` });
    const retainedAfter = await retainedHeap();
    const result = { name: scene.name, query: scene.query, coldMs, warmMs, initial, warm,
      retainedHeap: { before: retainedBefore, after: retainedAfter },
      frameIntervalMs: { samples: frameIntervals.length, p50: frameIntervals[Math.ceil(frameIntervals.length * .5) - 1], p95: frameIntervals[Math.ceil(frameIntervals.length * .95) - 1] },
      memory, errors };
    report.scenes.push(result);
    console.log(JSON.stringify({ scene: scene.name, coldMs: Math.round(coldMs), warmMs: Math.round(warmMs), p95FrameMs: result.frameIntervalMs.p95, errors }));
    await context.close();
    if (errors.length) throw Error("Browser benchmark encountered errors");
  }
} finally {
  await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.close();
}
