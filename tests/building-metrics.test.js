import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, Lane } from "../server/buildings/cache.mjs";

test("cache counters distinguish hits, missing entries and size rejections", async t => {
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), "lumen-cache-metrics-")));
  t.after(async () => { await unlink(cache.path("tile")).catch(() => {}); await rmdir(cache.directory); });
  assert.equal(await cache.get("missing"), null);
  await cache.put("tile", Buffer.from("building"));
  assert.equal((await cache.get("tile")).toString(), "building");
  assert.equal(await cache.get("tile", 2), null);
  assert.deepEqual(cache.metrics, { hits: 1, misses: 2, writes: 1, evictions: 0, bytesRead: 8 });
});
test("queue counters retain saturation and failures after the queue drains", async () => {
  const lane = new Lane(1, 1);
  let release;
  const first = lane.run(() => new Promise(resolve => { release = resolve; }));
  const second = lane.run(() => { throw Error("source failed"); });
  const rejected = assert.rejects(second, /source failed/);
  await assert.rejects(lane.run(() => {}), /busy/);
  assert.equal(lane.stats().queued, 1);
  release(); await first; await rejected;
  const stats = lane.stats();
  assert.equal(stats.active, 0); assert.equal(stats.queued, 0);
  assert.equal(stats.completed, 1); assert.equal(stats.failed, 1);
  assert.equal(stats.rejected, 1); assert.equal(stats.highWater, 1);
});
