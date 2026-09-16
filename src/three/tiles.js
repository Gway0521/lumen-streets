import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mercator } from "./geo.js";
import {
  buildingPolygons,
  footprintCenter,
  uniqueBuildingShells,
} from "./building-source.js";

// Fixed source detail preserves individual buildings even when the atlas is zoomed out.
// Only compressed buffers are cached; decoded tile objects are short-lived.
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
  async load(bounds, url, mobile, signal, consume) {
    if (url !== this.url) {
      this.url = url;
      this.metadata = null;
      this.cache.clear();
      this.bytes = 0;
    }
    if (!this.metadata) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw Error("Building tile source unavailable");
      this.metadata = await response.json();
    }
    const template = this.metadata.tiles?.[0];
    if (!template) throw Error("Building TileJSON has no tiles");
    const selection = coveringBuildings(bounds, mobile ? 96 : 180);
    const concurrency = mobile ? 2 : 4;
    for (
      let cursor = 0;
      cursor < selection.tiles.length;
      cursor += concurrency
    ) {
      const batch = selection.tiles.slice(cursor, cursor + concurrency);
      const buffers = await Promise.all(
        batch.map(async (t) => {
          signal?.throwIfAborted();
          const key = `${t.z}/${t.x}/${t.y}`;
          let bytes = this.cache.get(key);
          if (!bytes) {
            const endpoint = template
              .replace("{z}", t.z)
              .replace("{x}", t.x)
              .replace(
                "{y}",
                this.metadata.scheme === "tms" ? 2 ** t.z - 1 - t.y : t.y,
              );
            const r = await fetch(new URL(endpoint, url), { signal });
            if (!r.ok) throw Error(`Building tile unavailable (${r.status})`);
            bytes = await r.arrayBuffer();
            if (bytes.byteLength > 8 * 1048576)
              throw Error("Building tile exceeds its size budget");
            this.cache.set(key, bytes);
            this.bytes += bytes.byteLength;
          } else {
            this.cache.delete(key);
            this.cache.set(key, bytes);
          }
          while (this.bytes > (mobile ? 8 : 24) * 1048576) {
            const oldest = this.cache.keys().next().value;
            this.bytes -= this.cache.get(oldest).byteLength;
            this.cache.delete(oldest);
          }
          return bytes;
        }),
      );
      for (const [index, t] of batch.entries()) {
        signal?.throwIfAborted();
        const decoded = new VectorTile(new PbfReader(buffers[index])).layers;
        const layer = decoded.building;
        const features = [];
        for (let i = 0; i < (layer?.length || 0); i++) {
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
        features.sort(
          (a, b) =>
            (Number(b.properties.render_height) || 8) -
            (Number(a.properties.render_height) || 8),
        );
        const environment = {};
        for (const name of ["water", "park", "landcover", "transportation"]) {
          const source = decoded[name];
          environment[name] = [];
          for (let i = 0; i < (source?.length || 0); i++)
            environment[name].push(source.feature(i).toGeoJSON(t.x, t.y, t.z));
        }
        consume(uniqueBuildingShells(features), environment);
      }
      // Let cancellation messages run even when all requested tiles are cached.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      tileCount: selection.tiles.length,
      tileLimited: selection.limited,
      cacheMiB: this.bytes / 1048576,
    };
  }
}
