/** Geographic selection v1. Bbox order matches Overpass: south, west, north, east. */
export class MapRequestError extends Error {
  constructor(code, status = 400, retryAfter = 0) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function selection(value) {
  if (!value || !Array.isArray(value.center) || value.center.length !== 2 ||
      !value.center.every(Number.isFinite) || ![1, 2, 4].includes(value.size))
    throw new MapRequestError("invalidArea");
  const center = value.center.map(n => Math.round(n * 1e6) / 1e6);
  const [lon, lat] = center;
  if (Math.abs(lat) > 80 || Math.abs(lon) > 180) throw new MapRequestError("invalidArea");
  const dy = value.size * 500 / 111320;
  const dx = dy / Math.cos(lat * Math.PI / 180);
  const bbox = [lat - dy, lon - dx, lat + dy, lon + dx].map(n => Math.round(n * 1e6) / 1e6);
  if (bbox[1] < -180 || bbox[3] > 180 || bbox[0] < -80 || bbox[2] > 80)
    throw new MapRequestError("invalidArea");
  return { center, size: value.size, bbox };
}
export function searchInput(value) {
  if (typeof value?.query !== "string" || !["en", "zh-TW"].includes(value.locale))
    throw new MapRequestError("invalidSearch");
  const query = value.query.normalize("NFC").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query))
    throw new MapRequestError("invalidSearch");
  return { query, locale: value.locale };
}
