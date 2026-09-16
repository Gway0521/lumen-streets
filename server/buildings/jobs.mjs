import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { DiskCache, digest } from "./cache.mjs";

const hour = 3600000;
export function nationalCoverage(b, catalog) {
  return catalog.some(
    (s) =>
      s.enabled &&
      b[2] >= s.bounds[0] &&
      b[0] <= s.bounds[2] &&
      b[3] >= s.bounds[1] &&
      b[1] <= s.bounds[3],
  );
}

/** Two bounded lanes keep slow national downloads from blocking global context. */
export function createJobs({
  directory,
  python = process.env.LUMEN_BUILDINGS_PYTHON ||
    resolve(
      ".cache/building-venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  runner,
} = {}) {
  const cache = new DiskCache(join(directory, "results"), 256 * 1048576);
  const work = join(directory, "work"),
    sources = join(directory, "sources");
  const entries = new Map(),
    queues = { context: [], national: [] },
    active = { context: false, national: false },
    children = new Set();
  let closed = false;
  const stopChild = (child) => {
    if (!child.pid) return;
    // Windows venv python is a launcher with a child interpreter. Terminating
    // just the launcher would leave a timed-out geospatial job running.
    if (process.platform === "win32")
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      }).on("error", () => child.kill());
    else child.kill("SIGKILL");
  };
  let catalog = [];
  const ready = Promise.all([
    mkdir(work, { recursive: true }),
    mkdir(sources, { recursive: true }),
    runner ? true : access(python),
    readFile(resolve("data/building-sources.json"), "utf8").then((text) => {
      catalog = JSON.parse(text).supplements;
    }),
  ]).then(
    () => true,
    () => false,
  );
  const execute =
    runner ||
    ((input, output, stage) =>
      new Promise((ok, fail) => {
        const child = spawn(
          python,
          [
            "-X",
            "utf8",
            resolve("scripts/buildings/enrich.py"),
            "--input",
            input,
            "--output",
            output,
            "--cache",
            sources,
            "--stage",
            stage,
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        children.add(child);
        let log = "";
        for (const stream of [child.stdout, child.stderr])
          stream.on("data", (data) => {
            log = (log + data.toString()).slice(-4096);
          });
        const timer = setTimeout(
          () => stopChild(child),
          stage === "context" ? 120000 : 300000,
        );
        timer.unref();
        child.on("error", fail);
        child.on("close", (code) => {
          clearTimeout(timer);
          children.delete(child);
          if (code === 0) ok();
          else fail(Error(`Enrichment exited ${code}: ${log}`));
        });
      }));
  async function prune() {
    // Only generated filenames in owned cache directories are eligible.
    for (const [dir, budget, pattern] of [
      [sources, 2 * 1024 ** 3, /^[a-f0-9]{64}(?:\.(?:json|tif|part))?$/],
      [
        work,
        512 * 1048576,
        /^[a-f0-9]{64}\.(?:input|context|national)(?:\.audit\.gz|\.tmp)?$/,
      ],
    ]) {
      const files = [];
      for (const name of await readdir(dir)) {
        if (
          !pattern.test(name) ||
          [...entries.values()].some(
            (e) =>
              (e.busy || ["queued", "pending"].includes(e.value.status)) &&
              name.startsWith(e.id),
          )
        )
          continue;
        const p = join(dir, name);
        try {
          const s = await stat(p);
          files.push({ p, size: s.size, time: s.mtimeMs });
        } catch {}
      }
      let total = files.reduce((n, f) => n + f.size, 0);
      for (const f of files.sort((a, b) => a.time - b.time)) {
        if (total <= budget) break;
        // Downloads refresh mtime before use. This exceeds both worker limits,
        // so another lane cannot still be reading an eligible source file.
        if (dir === sources && Date.now() - f.time < 600000) continue;
        await unlink(f.p).catch(() => {});
        total -= f.size;
      }
    }
  }
  async function valueOf(entry) {
    if (entry.value.overrides) return entry.value;
    const bytes = await cache.get(entry.key);
    if (bytes)
      return {
        ...JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1048576 })),
        ...entry.value,
      };
    // A long national queue may outlive the result-cache LRU entry. Its
    // protected context file still holds the published global evidence.
    const context = join(work, entry.id + ".context");
    if ((await stat(context)).size > 16 * 1048576)
      throw Error("Context result budget");
    return { ...JSON.parse(await readFile(context, "utf8")), ...entry.value };
  }
  async function save(entry) {
    const value = await valueOf(entry);
    value.updated = Date.now();
    await cache.put(entry.key, gzipSync(JSON.stringify(value)));
    const { overrides, ...metadata } = value;
    entry.value = metadata;
  }
  async function pump(stage) {
    if (active[stage] || closed) return;
    const entry = queues[stage].shift();
    if (!entry) return;
    active[stage] = true;
    entry.busy = true;
    const input = join(work, entry.id + ".input"),
      output = join(work, entry.id + "." + stage);
    try {
      if (stage === "national") {
        const payload = JSON.parse(await readFile(input, "utf8"));
        payload.context = await valueOf(entry);
        await writeFile(input, JSON.stringify(payload));
      }
      await execute(input, output, stage);
      const s = await stat(output);
      if (s.size > 16 * 1048576) throw Error("Enrichment result budget");
      const result = JSON.parse(await readFile(output, "utf8"));
      if (!result.overrides || !Array.isArray(result.credits) || !result.states)
        throw Error("Invalid enrichment result");
      entry.value = {
        ...result,
        status: stage === "context" && entry.national ? "pending" : "complete",
      };
      if (
        Object.values(result.states).includes("failed") &&
        entry.value.status === "complete"
      )
        entry.value.status = "partial";
      await save(entry);
      if (stage === "context" && entry.national) {
        if (queues.national.length < 96) {
          queues.national.push(entry);
          void pump("national");
        } else {
          entry.value.status = "partial";
          entry.value.states.national = "deferred";
          await save(entry);
        }
      }
    } catch (error) {
      if (closed) return; // Shutdown is not a provider failure or negative cache.
      console.warn(
        JSON.stringify({
          event: "building_enrichment_failed",
          stage,
          message: error.message.slice(0, 500),
        }),
      );
      entry.value = {
        ...entry.value,
        status: "partial",
        states: { ...entry.value.states, [stage]: "failed" },
      };
      await save(entry).catch(() => {});
    } finally {
      entry.busy = false;
      active[stage] = false;
      // Completed values live on disk. After eviction a new request must
      // regenerate the result, not retain a metadata-only "complete" entry.
      if (
        !["queued", "pending"].includes(entry.value.status) &&
        entries.get(entry.key) === entry
      )
        entries.delete(entry.key);
      void pump(stage);
      void prune().catch(() => {});
    }
  }
  return {
    ready,
    async get(key, features, bounds) {
      if (!(await ready))
        return {
          status: "unavailable",
          states: { worker: "unavailable" },
          overrides: {},
          credits: [],
        };
      let entry = entries.get(key);
      if (
        entry &&
        (entry.busy ||
          ["queued", "pending"].includes(entry.value.status) ||
          Date.now() - entry.value.updated <
            (entry.value.status === "complete" ? 7 * 24 * hour : hour))
      )
        return valueOf(entry);
      const bytes = await cache.get(key);
      if (bytes) {
        try {
          const value = JSON.parse(
            gunzipSync(bytes, { maxOutputLength: 16 * 1048576 }),
          );
          if (
            Date.now() - value.updated <
              (value.status === "complete" ? 7 * 24 * hour : hour) &&
            !["queued", "pending"].includes(value.status)
          )
            return value;
        } catch {}
      }
      entry = entries.get(key);
      if (
        entry &&
        (entry.busy || ["queued", "pending"].includes(entry.value.status))
      )
        return valueOf(entry);
      if (queues.context.length >= 96)
        return {
          status: "deferred",
          overrides: {},
          credits: [],
          states: { context: "deferred" },
        };
      for (const [k, e] of entries) {
        if (entries.size < 256) break;
        if (
          !e.busy &&
          !queues.context.includes(e) &&
          !queues.national.includes(e)
        )
          entries.delete(k);
      }
      entry = {
        id: digest(key),
        key,
        national: nationalCoverage(bounds, catalog),
        value: {
          status: "queued",
          overrides: {},
          credits: [],
          states: {},
          updated: Date.now(),
        },
      };
      entries.set(key, entry);
      await writeFile(
        join(work, entry.id + ".input"),
        JSON.stringify({ features, bounds }),
      );
      queues.context.push(entry);
      void pump("context");
      return entry.value;
    },
    close() {
      closed = true;
      queues.context.length = 0;
      queues.national.length = 0;
      for (const child of children) stopChild(child);
    },
  };
}
