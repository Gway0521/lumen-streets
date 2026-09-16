import { mercator } from "./geo.js";
import { tileHeight } from "./building-heights.js";

export async function boundedBytes(response, maximum, signal) {
  if (!response.ok) throw Error(`Building data unavailable (${response.status})`);
  if (Number(response.headers.get("content-length")) > maximum)
    throw Error("Building data exceeds its size budget");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw Error("Building data exceeds its size budget");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}

export function validateManifest(data) {
  const credits = values => Array.isArray(values) && values.length <= 32 &&
    values.every(s => typeof s === "string" && s.length > 0 && s.length <= 500);
  if (data?.version !== 1 || data.zoom !== 14 || !Array.isArray(data.regions) ||
      data.regions.length > 4096 || !credits(data.attribution))
    throw Error("Unsupported building height manifest");
  for (const r of data.regions) {
    const b = r.tile_bounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(n => Number.isInteger(n) && n >= 0 && n < 16384) ||
        b[0] > b[2] || b[1] > b[3] || typeof r.tiles !== "string" ||
        !["{z}", "{x}", "{y}"].every(s => r.tiles.includes(s)) ||
        (r.attribution !== undefined && !credits(r.attribution)))
      throw Error("Invalid prepared building coverage");
  }
  return data;
}

export function heightRegion(metadata, tile) {
  return metadata?.regions.find(r => tile.x >= r.tile_bounds[0] && tile.x <= r.tile_bounds[2] &&
    tile.y >= r.tile_bounds[1] && tile.y <= r.tile_bounds[3]);
}

export function pointTile(point) {
  const p = mercator(...point);
  return `${((Math.floor(p[0] * 16384) % 16384) + 16384) % 16384}/${Math.max(0, Math.min(16383, Math.floor(p[1] * 16384)))}`;
}

export function decodeHeightTile(bytes) {
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length > 30000)
    throw Error("Invalid prepared building tile");
  let points = 0;
  for (const f of data.features) {
    if (f?.type !== "Feature" || typeof f.id !== "string" || !f.id || f.id.length > 500 ||
        f.properties?.lumen_height_version !== 1)
      throw Error("Prepared building has no stable identity or height schema");
    tileHeight(f.properties);
    const polygons = f.geometry?.type === "Polygon" ? [f.geometry.coordinates] :
      f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates : null;
    if (!Array.isArray(polygons) || !polygons.length) throw Error("Invalid building polygon");
    for (const rings of polygons) {
      if (!Array.isArray(rings) || !rings.length) throw Error("Invalid building rings");
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.length > 8192)
          throw Error("Invalid building ring");
        for (const p of ring) {
          if (++points > 300000 || !Array.isArray(p) || p.length < 2 ||
              !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85.1)
            throw Error("Invalid building coordinates");
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
          throw Error("Building ring is not closed");
      }
    }
  }
  return data.features;
}
