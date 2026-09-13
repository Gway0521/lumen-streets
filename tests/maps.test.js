import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { selection, searchInput } from "../src/search/area.js";
import { validateMap } from "../src/search/validate.js";
import { createMapService, mapMiddleware, mapQuery } from "../server/maps.mjs";
import { importedScene } from "../src/search/providers.ts";

const area = { center: [135.7588, 34.9858], size: 1 };
const raw = { elements: [{ type: "way", id: 9, nodes: [1, 2], tags: { highway: "residential" }, geometry: [{ lon: 135.758, lat: 34.985 }, { lon: 135.759, lat: 34.986 }] }] };
const photon = { features: [{ geometry: { coordinates: area.center }, properties: { name: "Kyoto", city: "Kyoto", country: "Japan", osm_type: "N", osm_id: 1 } }] };
const signal = () => new AbortController().signal;
async function setup(t, fetcher, options = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), "lumen-map-test-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return { cacheDir, service: createMapService({ cacheDir, fetcher, interval: 0, ...options }) };
}
test("bounded squares have physical dimensions and reject wraparound, poles, coercion and oversized inputs", () => {
  for (const size of [1, 2, 4]) for (const lat of [0, 35, -50, 79]) {
    const a = selection({ center: [135, lat], size });
    assert(Math.abs((a.bbox[2] - a.bbox[0]) * 111320 - size * 1000) < 0.2);
    assert(Math.abs((a.bbox[3] - a.bbox[1]) * 111320 * Math.cos(lat * Math.PI / 180) - size * 1000) < 0.2);
  }
  for (const input of [{ center: [180, 0], size: 1 }, { center: [0, 81], size: 1 }, { center: [0, 0], size: 3 }, { center: ["0", 0], size: 1 }, { center: [0, NaN], size: 1 }]) assert.throws(() => selection(input));
  assert.equal(searchInput({ query: "  Kyoto   Station  ", locale: "en" }).query, "Kyoto Station");
  assert.throws(() => searchInput({ query: "x".repeat(121), locale: "en" }));
  assert.throws(() => mapQuery({ center: ["0);out;", 0], size: 1 }));
  assert.match(mapQuery(area), /maxsize:33554432/);
});
test("validation rejects truncated responses, corrupt geometry, empty areas and excessive complexity", () => {
  assert.equal(validateMap(raw), raw);
  assert.doesNotThrow(() => validateMap({ elements: [] }, true));
  for (const data of [{ elements: [] }, { ...raw, remark: "runtime error: timeout" }, { elements: [null] }, { elements: [{ ...raw.elements[0], geometry: [{ lon: Infinity, lat: 0 }] }] }, { elements: Array(30001).fill(raw.elements[0]) }, { elements: [{ type: "relation", id: 1, members: Array(257).fill({}) }] }]) assert.throws(() => validateMap(data));
  assert.throws(() => validateMap({ elements: Array.from({ length: 257 }, (_, i) => ({ type: "node", id: i + 1, lon: 135, lat: 35 })) }, true), e => e.code === "tooDense");
});
test("chunked responses and daily allowances are bounded before normalization, including across restart", async t => {
  const { service } = await setup(t, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(24000001)); c.close(); } })));
  await assert.rejects(service.map(area, signal()), e => e.code === "tooDense");
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(photon); };
  const daily = await setup(t, fetcher, { budget: 100 });
  await assert.rejects(daily.service.search({ query: "Kyoto", locale: "en" }, signal()), e => e.code === "tooDense");
  const reopened = createMapService({ cacheDir: daily.cacheDir, fetcher, budget: 100, interval: 0 });
  await assert.rejects(reopened.search({ query: "Tokyo", locale: "en" }, signal()), e => e.code === "dailyLimit");
  assert.equal(calls, 1);
});
test("all eight reference maps and rail snapshots fit import resource limits", async () => {
  for (const name of await readdir(new URL("../public/data/", import.meta.url))) {
    const data = JSON.parse(await readFile(new URL("../public/data/" + name, import.meta.url)));
    assert.doesNotThrow(() => validateMap(data, name.includes("-rail")), name);
  }
});
test("cache survives restart; source metadata and fingerprints are stable, bounds and service versions are separate", async t => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(raw); };
  const { service, cacheDir } = await setup(t, fetcher);
  const a = await service.map(area, signal()), b = await service.map(area, signal());
  assert.equal(calls, 1); assert.equal(b.cache, "hit"); assert.equal(a.fingerprint, b.fingerprint);
  const reopened = createMapService({ cacheDir, fetcher, interval: 0 });
  assert.equal((await reopened.map(area, signal())).cache, "hit"); assert.equal(calls, 1);
  await reopened.map({ ...area, size: 2 }, signal()); assert.equal(calls, 2);
  const scene = await importedScene(area, "Kyoto", a, null);
  assert.equal(scene.geometry.railUnavailable, true); assert.equal(scene.geometry.english, "Kyoto");
  assert(Object.isFrozen(scene.geometry.roads[0])); assert.match(scene.source.map.url, /^https:/);
  assert.equal(scene.fingerprint, (await importedScene(area, "Kyoto", b, null)).fingerprint);
  await assert.rejects(importedScene(area, "Kyoto", { ...a, fingerprint: "changed" }, null));
  await assert.rejects(importedScene({ ...area, size: 2 }, "Kyoto", a, null));
});
test("Photon request is encoded, result text is bounded and cached independently per language", async t => {
  const urls = [];
  const { service } = await setup(t, async url => { urls.push(String(url)); return Response.json(photon); });
  const input = { query: "Kyoto & Tokyo", locale: "en" };
  assert.equal((await service.search(input, signal())).results[0].context, "Japan");
  await service.search(input, signal()); assert.equal(urls.length, 1); assert.match(urls[0], /q=Kyoto\+%26\+Tokyo/);
  await service.search({ ...input, locale: "zh-TW" }, signal()); assert.equal(urls.length, 2);
});
test("quota cooldown survives restart and does not automatically retry or change hosts", async t => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("busy", { status: 429, headers: { "Retry-After": "120" } }); };
  const { service, cacheDir } = await setup(t, fetcher);
  await assert.rejects(service.map(area, signal()), e => e.code === "quota" && e.retryAfter === 120);
  const second = createMapService({ cacheDir, fetcher });
  await assert.rejects(second.map(area, signal()), e => e.code === "quota"); assert.equal(calls, 1);
});
test("timeouts, partial data and byte limits are actionable and never cached as success", async t => {
  let mode = "partial";
  const { service } = await setup(t, async () => mode === "partial" ? Response.json({ ...raw, remark: "timeout" }) : new Response("large", { headers: { "Content-Length": "25000000" } }));
  await assert.rejects(service.map(area, signal()), e => e.code === "partialData");
  mode = "large";
  await assert.rejects(service.map(area, signal()), e => e.code === "tooDense");
  const timed = await setup(t, async (_, { signal }) => new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("unexpected timeout")), 300);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }), { timeout: 10 });
  await assert.rejects(timed.service.map(area, signal()), e => e.code === "timeout");
});
test("cancellation reaches upstream, prevents caching, and a later load can recover", async t => {
  let aborted = false, started;
  const ready = new Promise(r => { started = r; });
  const { service } = await setup(t, async (_, { signal }) => {
    started();
    if (aborted) return Response.json(raw);
    return new Promise((_, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
  });
  const controller = new AbortController(), task = service.map(area, controller.signal);
  await ready; controller.abort(); await assert.rejects(task, e => e.name === "AbortError");
  assert(aborted); assert.equal((await service.map(area, signal())).cache, "miss");
});
test("loopback JSON gateway rejects cross-origin and arbitrary paths before calling providers", async t => {
  let calls = 0;
  const middleware = mapMiddleware({ search: async () => { calls++; return { results: [] }; } });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = headers => fetch(base + "/api/search", { method: "POST", headers, body: "{}" });
  assert.equal((await send({ "Content-Type": "application/json", Origin: "https://evil.test" })).status, 403);
  assert.equal((await send({ "Content-Type": "text/plain" })).status, 400);
  const badHost = await new Promise(resolve => {
    const req = request(base + "/api/search", { method: "POST", headers: { "Content-Type": "application/json", Host: "evil.test" } }, res => { res.resume(); resolve(res.statusCode); });
    req.end("{}");
  });
  assert.equal(badHost, 403);
  assert.equal(calls, 0);
  assert.equal((await send({ "Content-Type": "application/json", Origin: base })).status, 200); assert.equal(calls, 1);
  assert.equal((await fetch(base + "/api/capabilities")).status, 200);
  assert.equal((await fetch(base + "/api/proxy?url=https://example.com")).status, 404);
});
