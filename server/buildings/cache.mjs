import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export class DiskCache {
  constructor(directory, budget = 512 * 1048576) {
    this.directory = directory;
    this.budget = budget;
    this.ready = mkdir(directory, { recursive: true });
    this.lastPrune = 0;
    this.metrics = { hits: 0, misses: 0, writes: 0, evictions: 0, bytesRead: 0 };
  }
  path(key) {
    return join(this.directory, digest(key) + ".bin");
  }
  async get(key, maximum = 16 * 1048576) {
    await this.ready;
    try {
      const p = this.path(key),
        s = await stat(p);
      if (s.size > maximum) { this.metrics.misses++; return null; }
      const data = await readFile(p);
      this.metrics.hits++; this.metrics.bytesRead += data.length;
      return data;
    } catch (e) {
      if (e.code === "ENOENT") { this.metrics.misses++; return null; }
      throw e;
    }
  }
  async put(key, data) {
    await this.ready;
    const p = this.path(key),
      temp = p + "." + randomUUID() + ".tmp";
    await writeFile(temp, data);
    await rename(temp, p);
    this.metrics.writes++;
    await this.prune();
  }
  async prune() {
    if (Date.now() - this.lastPrune < 60000) return;
    this.lastPrune = Date.now();
    let entries = [];
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.bin$/.test(name)) continue;
      const p = join(this.directory, name);
      try {
        const s = await stat(p);
        entries.push({ p, size: s.size, time: s.mtimeMs });
      } catch {}
    }
    let total = entries.reduce((n, e) => n + e.size, 0);
    entries.sort((a, b) => a.time - b.time);
    for (const e of entries) {
      if (total <= this.budget) break;
      await unlink(e.p).catch(() => {});
      total -= e.size;
      this.metrics.evictions++;
    }
  }
}
export class Lane {
  active = 0;
  queue = [];
  constructor(limit = 4, maximum = 128) {
    this.limit = limit;
    this.maximum = maximum;
    this.metrics = { completed: 0, failed: 0, rejected: 0, highWater: 0, waitMs: 0, maxWaitMs: 0 };
  }
  stats() { return { ...this.metrics, active: this.active, queued: this.queue.length }; }
  async run(fn) {
    const queuedAt = performance.now();
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maximum) {
        this.metrics.rejected++;
        throw Object.assign(Error("Building service busy"), { status: 503 });
      }
      await new Promise((resolve) => { this.queue.push(resolve); this.metrics.highWater = Math.max(this.metrics.highWater, this.queue.length); });
    } else this.active++;
    const waited = performance.now() - queuedAt;
    this.metrics.waitMs += waited; this.metrics.maxWaitMs = Math.max(this.metrics.maxWaitMs, waited);
    try {
      const result = await fn();
      this.metrics.completed++;
      return result;
    } catch (error) {
      this.metrics.failed++;
      throw error;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
