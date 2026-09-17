import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createBuildingService } from "../server/buildings/index.mjs";
import { DiskCache } from "../server/buildings/cache.mjs";

// This measures the local cache, queue, normalization and compression path.
// It deliberately excludes provider downloads and Python enrichment capacity.
const output = resolve(process.env.QA_OUTPUT || "artifacts/performance");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "service-cache-"));
const cache = new DiskCache(directory);
const fixture = { type: "Feature", id: "synthetic/building", geometry: { type: "Polygon", coordinates: [[[0, 0], [.001, 0], [.001, .001], [0, .001], [0, 0]]] }, properties: { height: 30 } };
const source = { release: "synthetic-1", stats: () => ({ cache: { ...cache.metrics } }),
  async features(x, y) {
    const key = `${x}/${y}`, cached = await cache.get(key);
    if (cached) return JSON.parse(cached);
    await new Promise(resolve => setTimeout(resolve, 20));
    const features = Array.from({ length: 200 }, (_, i) => ({ ...fixture, id: `synthetic/${x}/${y}/${i}` }));
    await cache.put(key, Buffer.from(JSON.stringify(features))); return features;
  } };
const service = createBuildingService({ source, jobs: { async get() { return { status: "complete", overrides: {}, credits: [], states: {} }; }, close() {} } });
const report = { mode: "synthetic service workload; no external requests or Python jobs", node: process.version, workloads: [] };
try {
  for (const [name, unique] of [["cold-distinct", true], ["warm-distinct", true], ["shared-view", false]]) {
    const latencies = [], start = performance.now(), before = service.stats();
    await Promise.all(Array.from({ length: 24 }, async (_, i) => {
      const began = performance.now(); await service.tile(14, unique ? i : 0, 8192); latencies.push(performance.now() - began);
    }));
    latencies.sort((a, b) => a - b);
    report.workloads.push({ name, requests: 24, elapsedMs: performance.now() - start,
      p50Ms: latencies[11], p95Ms: latencies[22], before, after: service.stats() });
  }
  console.log(JSON.stringify(report, null, 2));
  await writeFile(join(output, "service.json"), JSON.stringify(report, null, 2));
} finally { service.close(); }
