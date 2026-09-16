import regions from "../regions.json" with { type: "json" };
import { VIEW } from "./view.js";
export const EARTH = 40075016.68557849;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function mercator(lon, lat) {
  const y = (clamp(lat, -85.051129, 85.051129) * Math.PI) / 180;
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + y / 2)) / Math.PI) / 2,
  ];
}
export function unproject(x, y) {
  return [
    x * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  ];
}
export const metreScale = (lat) =>
  1 / (EARTH * Math.cos((lat * Math.PI) / 180));
export function localPoint(lon, lat, center) {
  const p = mercator(lon, lat),
    o = mercator(...center),
    s = metreScale(center[1]);
  let dx = p[0] - o[0];
  dx -= Math.round(dx);
  return [dx / s, (p[1] - o[1]) / s];
}
export function snapshotPoint(p, center) {
  return localPoint(
    center[0] + p[0] / (111320 * Math.cos((center[1] * Math.PI) / 180)),
    center[1] - p[1] / 111320,
    center,
  );
}
export function detailLevel(zoom) {
  return zoom < VIEW.atlas ? "map" : zoom < 13.8 ? "district" : "aerial";
}
export function geometryKey(feature) {
  // Vector tiles repeat clipped features at tile boundaries. Geometry is part of the key:
  // equal OSM identities can legitimately have different clipped rings.
  return `${feature.id ?? ""}:${JSON.stringify(feature.geometry.coordinates)}`;
}
export function viewRecipe(input = {}) {
  const city = Object.hasOwn(regions, input.city) ? input.city : "shanghai";
  const center =
    city === "shanghai" ? [121.4938, 31.2359] : regions[city].center;
  const number = (key, fallback, a, b) =>
    Number.isFinite(Number(input[key]))
      ? clamp(Number(input[key]), a, b)
      : fallback;
  return {
    lng: number("lng", center[0], -180, 180),
    lat: number("lat", center[1], -80, 80),
    zoom: number("zoom", VIEW.desktop, 2, VIEW.nearest),
    bearing: number("bearing", -8, -360, 360),
    pitch: number("pitch", VIEW.pitch, 0, 55),
    glow: number("glow", 1, 0.4, 1.6),
    density: number("density", 700, 0, 1600),
    city: [
      "shanghai",
      "sapporo",
      "xinyi",
      "tokyo",
      "ntu",
      "beijing",
      "seattle",
      "washington",
    ].includes(input.city)
      ? input.city
      : "shanghai",
  };
}
