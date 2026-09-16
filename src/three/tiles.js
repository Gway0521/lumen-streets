import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mercator } from "./geo.js";
import { renderedHeight } from "./building-heights.js";
import { boundedBytes, parseHeightTile, heightRegion, validateManifest } from "./height-tiles.js";
import {
  buildingPolygons,
  footprintCenter,
  uniqueBuildingShells,
} from "./building-source.js";

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
  cache = new Map();
  bytes = 0;
  heightTimes = new Map();
  async buffer(key, endpoint, mobile, signal) {
    if (key.startsWith("height/") && Date.now() - (this.heightTimes.get(key) || 0) > 30000 && this.cache.has(key)) { this.bytes -= this.cache.get(key).byteLength; this.cache.delete(key); }
    let bytes = this.cache.get(key);
    if (!bytes) {
      bytes = await boundedBytes(await fetch(endpoint, { signal }), 8 * 1048576, signal);
      signal?.throwIfAborted();
      this.cache.set(key, bytes);
      if (key.startsWith("height/")) this.heightTimes.set(key, Date.now());
      this.bytes += bytes.byteLength;
    } else {
      this.cache.delete(key);
      this.cache.set(key, bytes);
    }
    while (this.bytes > (mobile ? 8 : 24) * 1048576) {
      const oldest = this.cache.keys().next().value;
      this.bytes -= this.cache.get(oldest).byteLength;
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
    heightURL = heightURL || null;
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
      const response = await fetch(url, { signal });
      if (!response.ok) throw Error("Building tile source unavailable");
      this.metadata = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 2 * 1048576, signal)));
    }
    if (heightURL && !this.heightMetadata) {
      const response = await fetch(heightURL, { signal });
      this.heightMetadata = validateManifest(JSON.parse(new TextDecoder().decode(
        await boundedBytes(response, 2 * 1048576, signal))));
    }
  }
  hasPreparedCoverage(bounds, mobile) {
    return coveringBuildings(bounds, mobile ? 96 : 180).tiles.some(t => heightRegion(this.heightMetadata, t));
  }
  async load(bounds, url, mobile, signal, consume, heightURL = null) {
    await this.configure(url, heightURL, signal);
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
          const region = heightRegion(this.heightMetadata, t);
          let prepared = null;
          if (region) {
            const source = region.tiles.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y);
            prepared = await this.buffer(`height/${key}`, new URL(source, heightURL), mobile, signal);
          }
          return { bytes, prepared };
        }),
      );
      const failed = results.find(r => r.status === "rejected");
      if (failed) throw failed.reason;
      const buffers = results.map(r => r.value);
      for (const [index, t] of batch.entries()) {
        signal?.throwIfAborted();
        const decoded = new VectorTile(new PbfReader(buffers[index].bytes)).layers;
        const layer = decoded.building;
        let features = [];
        const prepared = buffers[index].prepared;
        for (let i = 0; !prepared && i < (layer?.length || 0); i++) {
          const f = layer.feature(i);
          for (const polygon of buildingPolygons([
            f.toGeoJSON(t.x, t.y, t.z),
          ])) {
            const [x, y] = mercator(...footprintCenter(polygon));
            if (
              Math.floor(x * 2 ** t.z) !== t.x ||
              Math.floor(y * 2 ** t.z) !== t.y
            )
              continue;
            features.push(polygon);
          }
        }
        if (prepared) {
          const tile = parseHeightTile(prepared), info = tile.lumen;
          for (const credit of info?.attribution || heightRegion(this.heightMetadata, t).attribution || this.heightMetadata.attribution) credits.add(credit);
          if (info?.status) statuses.add(info.status);
          if (info?.revision) revisions.add(info.revision);
          preparedTiles.add(`${t.x}/${t.y}`);
          features = tile.features.filter(f => {
            if (identities.has(f.id)) return false;
            identities.add(f.id);
            return true;
          });
          features = buildingPolygons(features);
        }
        for (const f of features) {
          const method = prepared ? f.properties.height_method : "upstream-unknown";
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
        consume(prepared ? features : uniqueBuildingShells(features), environment, { prepared: !!prepared });
      }
      // Let cancellation messages run even when all requested tiles are cached.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      tileCount: selection.tiles.length,
      tileLimited: selection.limited,
      cacheMiB: this.bytes / 1048576,
      preparedTiles,
      heights,
      heightPending: [...statuses].some(s => ["pending", "queued", "deferred"].includes(s)),
      heightStatus: [...statuses],
      attribution: [...credits],
      heightRevision: preparedTiles.size ? [...revisions].sort().join("|") || this.heightMetadata.revision : null,
    };
  }
}
