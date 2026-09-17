// @ts-check
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mercator } from "./geo.js";
import { renderedHeight } from "./building-heights.js";
import { parseHeightTile, validateManifest } from "./height-tiles.js";
import { requestBytes } from "./request.js";
import { buildingPolygons } from "./building-source.js";

// Fixed source detail preserves individual buildings even when the atlas is zoomed out.
// Only encoded buffers are cached; decoded tile objects are short-lived.
export function coveringBuildings(bounds, maximum = 180) {
  const z = 14,
    n = 2 ** z;
  const a = mercator(bounds[0], bounds[3]),
    b = mercator(bounds[2], bounds[1]);
  let east = b[0];
  if (east < a[0]) east += 1;
  const cx = ((a[0] + east) * n) / 2,
    cy = ((a[1] + b[1]) * n) / 2;
  const tiles = [];
  for (
    let y = Math.max(0, Math.floor(a[1] * n));
    y <= Math.min(n - 1, Math.floor(b[1] * n));
    y++
  )
    for (let x = Math.floor(a[0] * n); x <= Math.floor(east * n); x++) {
      tiles.push({
        z,
        x: ((x % n) + n) % n,
        y,
        distance: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2,
      });
      // Inputs are a bounded aerial viewport, not an unrestricted world download.
      if (tiles.length > 2048) return { tiles: [], limited: true };
    }
  tiles.sort((a, b) => a.distance - b.distance);
  return { tiles: tiles.slice(0, maximum), limited: tiles.length > maximum };
}

export class BuildingTiles {
  /** @type {Map<string, ArrayBuffer>} */
  cache = new Map();
  metrics = { hits: 0, misses: 0, requests: 0 };
  /** @type {import("./contracts.ts").HeightManifest | null} */
  heightMetadata = null;
  bytes = 0;
  heightTimes = new Map();
  async buffer(key, endpoint, mobile, signal) {
    const expired = this.cache.get(key);
    if (key.startsWith("height/") && Date.now() - (this.heightTimes.get(key) || 0) > 30000 && expired) { this.bytes -= expired.byteLength; this.cache.delete(key); }
    let bytes = this.cache.get(key);
    if (!bytes) {
      this.metrics.misses++;
      bytes = await requestBytes(endpoint, { signal, onAttempt: () => this.metrics.requests++ });
      signal?.throwIfAborted();
      this.cache.set(key, bytes);
      if (key.startsWith("height/")) this.heightTimes.set(key, Date.now());
      this.bytes += bytes.byteLength;
    } else {
      this.metrics.hits++;
      this.cache.delete(key);
      this.cache.set(key, bytes);
    }
    while (this.bytes > (mobile ? 8 : 24) * 1048576) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.cache.get(oldest)?.byteLength || 0;
      this.cache.delete(oldest);
      this.heightTimes.delete(oldest);
    }
    return bytes;
  }
  clearHeights() {
    this.heightTimes.clear();
    for (const [key, bytes] of this.cache) if (key.startsWith("height/")) { this.bytes -= bytes.byteLength; this.cache.delete(key); }
  }
  async configure(url, heightURL, signal) {
    if (!heightURL) throw Error("Global building service is required");
    if (url !== this.url || heightURL !== this.heightURL) {
      this.url = url;
      this.heightURL = heightURL;
      this.metadata = null;
      this.heightMetadata = null;
      this.cache.clear();
      this.heightTimes.clear();
      this.bytes = 0;
    }
    if (!this.metadata) {
      this.metadata = JSON.parse(new TextDecoder().decode(await requestBytes(url, { signal, maximum: 2 * 1048576 })));
    }
    if (!this.heightMetadata) {
      this.heightMetadata = validateManifest(JSON.parse(new TextDecoder().decode(
        await requestBytes(heightURL, { signal, maximum: 2 * 1048576 }))));
    }
  }
  async load(bounds, url, mobile, signal, consume, heightURL) {
    await this.configure(url, heightURL, signal);
    const heightMetadata = this.heightMetadata;
    if (!heightMetadata) throw Error("Missing building manifest");
    const template = this.metadata.tiles?.[0];
    if (!template) throw Error("Building TileJSON has no tiles");
    const selection = coveringBuildings(bounds, mobile ? 96 : 180);
    const concurrency = mobile ? 2 : 4;
    const preparedTiles = new Set(), identities = new Set(), credits = new Set(), heights = {}, statuses = new Set(), revisions = new Set();
    for (
      let cursor = 0;
      cursor < selection.tiles.length;
      cursor += concurrency
    ) {
      const batch = selection.tiles.slice(cursor, cursor + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (t) => {
          signal?.throwIfAborted();
          const key = `${t.z}/${t.x}/${t.y}`;
          const endpoint = template
              .replace("{z}", t.z)
              .replace("{x}", t.x)
              .replace(
                "{y}",
                this.metadata.scheme === "tms" ? 2 ** t.z - 1 - t.y : t.y,
              );
          // Sequential requests within each slot keep the existing 4/2 total
          // concurrency and shared 24/8 MiB cache budgets, including enrichment.
          const bytes = await this.buffer(key, new URL(endpoint, url), mobile, signal);
          const source = heightMetadata.tiles.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
          const prepared = await this.buffer(`height/${key}`, new URL(source, heightURL), mobile, signal);
          return { bytes, prepared };
        }),
      );
      const failed = results.find(r => r.status === "rejected");
      if (failed) throw failed.reason;
      const buffers = results.map(r => { if (r.status === "rejected") throw r.reason; return r.value; });
      for (const [index, t] of batch.entries()) {
        signal?.throwIfAborted();
        const decoded = new VectorTile(new PbfReader(buffers[index].bytes)).layers;
        const tile = parseHeightTile(buffers[index].prepared), info = tile.lumen;
        for (const credit of info?.attribution || heightMetadata.attribution) credits.add(credit);
        if (info?.status) statuses.add(info.status);
        if (info?.revision) revisions.add(info.revision);
        preparedTiles.add(`${t.x}/${t.y}`);
        const features = buildingPolygons(tile.features.filter(f => {
          if (identities.has(f.id)) return false;
          identities.add(f.id);
          return true;
        }));
        for (const f of features) {
          const method = f.properties.height_method;
          heights[method] = (heights[method] || 0) + 1;
        }
        features.sort(
          (a, b) =>
            renderedHeight(b.properties) - renderedHeight(a.properties),
        );
        const environment = {};
        for (const name of ["water", "park", "landcover", "transportation"]) {
          const source = decoded[name];
          environment[name] = [];
          for (let i = 0; i < (source?.length || 0); i++)
            environment[name].push(source.feature(i).toGeoJSON(t.x, t.y, t.z));
        }
        consume(features, environment);
      }
      // Let cancellation messages run even when all requested tiles are cached.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      tileCount: selection.tiles.length,
      tileLimited: selection.limited,
      cacheMiB: this.bytes / 1048576,
      metrics: { ...this.metrics },
      preparedTiles,
      heights,
      heightPending: [...statuses].some(s => ["pending", "queued", "deferred"].includes(s)),
      heightStatus: [...statuses],
      attribution: [...credits],
      heightRevision: preparedTiles.size ? [...revisions].sort().join("|") || heightMetadata.revision || null : null,
    };
  }
}
