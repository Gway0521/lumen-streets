import { PMTiles, ResolvedValueCache } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import clipping from "polygon-clipping";
import { gzipSync, gunzipSync } from "node:zlib";
import { DiskCache, Lane } from "./cache.mjs";
import {
  GLOBAL_RELEASE,
  jsonAttribute,
} from "../../src/buildings/global-height.js";

export function boundsOf(x, y, z = 14) {
  const n = 2 ** z,
    lat = (v) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}
export function validateTile(z, x, y) {
  if (
    z !== 14 ||
    ![x, y].every((v) => Number.isInteger(v) && v >= 0 && v < 16384)
  )
    throw Object.assign(Error("Invalid building tile"), { status: 400 });
}
export function decodeMvt(bytes, x, y) {
  const layers = new VectorTile(new PbfReader(bytes)).layers,
    features = [];
  for (const name of ["building", "building_part"]) {
    const layer = layers[name];
    if ((layer?.length || 0) > 40000) throw Error("Building count budget");
    for (let i = 0; i < (layer?.length || 0); i++) {
      const f = layer.feature(i),
        p = f.properties;
      if (p.is_underground === true) continue;
      if (typeof p.id !== "string" || p.id.length > 200)
        throw Error("Missing building identity");
      const feature = f.toGeoJSON(x, y, 14);
      feature.id = `overture/${p.id}`;
      feature.properties = {
        ...p,
        type: name,
        sources: jsonAttribute(p.sources, []),
      };
      features.push(feature);
    }
  }
  return features;
}
function polygonBounds(f) {
  const points = f.geometry.coordinates.flat(
    f.geometry.type === "Polygon" ? 1 : 2,
  );
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p[0]);
    s = Math.min(s, p[1]);
    e = Math.max(e, p[0]);
    n = Math.max(n, p[1]);
  }
  return [w, s, e, n];
}
export function mergeFragments(features) {
  const groups = new Map();
  for (const f of features) {
    let g = groups.get(f.id);
    if (!g) {
      g = { ...f, fragments: [] };
      groups.set(f.id, g);
    }
    g.fragments.push(f.geometry.coordinates);
  }
  return [...groups.values()].map(({ fragments, ...f }) => {
    if (fragments.length === 1) return f;
    const coordinates = clipping.union(...fragments);
    return { ...f, geometry: { type: "MultiPolygon", coordinates } };
  });
}

export function createOvertureSource({
  cacheDir,
  release = GLOBAL_RELEASE,
  fetcher = fetch,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release))
    throw Error("Invalid Overture release");
  const url = `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${release}/buildings.pmtiles`;
  const disk = new DiskCache(cacheDir),
    lane = new Lane(8),
    inflight = new Map();
  const archive = new PMTiles(
    {
      getKey: () => url,
      getBytes: (offset, length) =>
        lane.run(async () => {
          if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            length > 8 * 1048576
          )
            throw Error("Source range budget");
          const r = await fetcher(url, {
            headers: { Range: `bytes=${offset}-${offset + length - 1}` },
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          });
          if (r.status !== 206) {
            await r.body?.cancel();
            throw Error(`Overture range unavailable (${r.status})`);
          }
          const chunks = [];
          let size = 0;
          for await (const c of r.body) {
            size += c.length;
            if (size > length) throw Error("Oversized source range");
            chunks.push(c);
          }
          const bytes = Buffer.concat(chunks);
          return {
            data: bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
            etag: r.headers.get("etag"),
          };
        }),
    },
    new ResolvedValueCache(64),
  );
  async function tile(x, y) {
    if (y < 0 || y >= 16384) return [];
    x = (x + 16384) % 16384;
    const key = `${release}/14/${x}/${y}`;
    if (inflight.has(key)) return inflight.get(key);
    const task = (async () => {
      let encoded = await disk.get(key);
      let bytes;
      if (encoded) {
        bytes = gunzipSync(encoded, { maxOutputLength: 8 * 1048576 });
      } else {
        const t = await archive.getZxy(14, x, y);
        bytes = t ? new Uint8Array(t.data) : new Uint8Array();
        if (bytes.byteLength > 8 * 1048576) throw Error("Source tile budget");
        await disk.put(key, gzipSync(bytes));
      }
      return decodeMvt(bytes, x, y);
    })();
    inflight.set(key, task);
    try {
      return await task;
    } finally {
      inflight.delete(key);
    }
  }
  const features = (x, y) => assembleFeatures(tile, x, y);
  return { features, release, url, stats: () => ({ cache: { ...disk.metrics }, lane: lane.stats() }) };
}

/** Follow the same GERS through neighbours until the footprint is complete.
 * Refuse a pathological footprint at the budget, rather than create false walls.
 */
export async function assembleFeatures(tile, x, y, maximum = 25) {
  validateTile(14, x, y);
  const first = await tile(x, y),
    ids = new Set(first.map((f) => f.id));
  const parents = new Set(
    first.filter((f) => f.properties.has_parts).map((f) => f.properties.id),
  );
  const all = [...first],
    visited = new Set([`${x}/${y}`]),
    pending = [];
  function edges(features, a, c) {
    const b = boundsOf(a, c);
    for (const f of features) {
      const q = polygonBounds(f),
        dx = [0],
        dy = [0];
      if (q[0] <= b[0] + 1e-8) dx.push(-1);
      if (q[2] >= b[2] - 1e-8) dx.push(1);
      if (q[1] <= b[1] + 1e-8) dy.push(1);
      if (q[3] >= b[3] - 1e-8) dy.push(-1);
      for (const da of dx)
        for (const dc of dy) {
          if (!da && !dc) continue;
          const nx = a + da,
            ny = c + dc;
          if (nx < 0 || nx >= 16384 || ny < 0 || ny >= 16384) continue;
          const k = `${nx}/${ny}`;
          if (!visited.has(k)) {
            visited.add(k);
            pending.push([nx, ny]);
          }
        }
    }
  }
  edges(first, x, y);
  while (pending.length) {
    if (visited.size > maximum)
      throw Error("Complete footprint exceeds tile budget");
    const batch = pending.splice(0, 8);
    const results = await Promise.all(
      batch.map(async ([a, c]) => {
        const selected = (await tile(a, c)).filter(
          (f) => ids.has(f.id) || parents.has(f.properties.building_id),
        );
        for (const f of selected) ids.add(f.id);
        return selected;
      }),
    );
    for (let i = 0; i < batch.length; i++) {
      all.push(...results[i]);
      edges(results[i], ...batch[i]);
    }
  }
  const merged = mergeFragments(all),
    withParts = new Set(
      merged
        .filter((f) => f.properties.type === "building_part")
        .map((f) => f.properties.building_id),
    );
  return merged.filter(
    (f) => !(f.properties.has_parts && withParts.has(f.properties.id)),
  );
}
