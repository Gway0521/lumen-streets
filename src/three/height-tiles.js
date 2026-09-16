import { expandTile } from "../buildings/tile-wire.js";
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
  if (data?.version !== 2 || data.zoom !== 14 || data.global !== true ||
      data.regions !== undefined || !credits(data.attribution) ||
      typeof data.tiles !== "string" ||
      !["{z}", "{x}", "{y}"].every(s => data.tiles.includes(s)))
    throw Error("Unsupported building height manifest");
  return data;
}

export function decodeHeightTile(bytes) { return parseHeightTile(bytes).features; }
export function parseHeightTile(bytes) {
  const data = expandTile(JSON.parse(new TextDecoder().decode(bytes)));
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
  return data;
}
