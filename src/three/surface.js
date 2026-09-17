import { roadWidth } from "../shared/roads.js";
import { snapshotPoint } from "./geo.js";
import { resolveHeight, featureSeed } from "../buildings/heights.js";
import { buildingArea } from "../lighting.js";

// A small, transparent, world-aligned surface adds contact shadows and road halos.
// No buildings are baked into it; physical facades and moving lights keep true depth.
export async function groundSurface(city, mobile) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const [x0, y0, x1, y1] = city.bounds,
    size = mobile ? 1536 : 2560;
  const scale = size / Math.max(x1 - x0, y1 - y0);
  const canvas = new OffscreenCanvas(
    Math.ceil((x1 - x0) * scale),
    Math.ceil((y1 - y0) * scale),
  );
  const c = canvas.getContext("2d");
  c.scale(scale, scale);
  c.translate(-x0, -y0);
  // A restrained contact shadow separates roof masses from the street surface.
  c.fillStyle = "rgba(1,6,9,.32)";
  for (const f of city.buildings) {
    const seed = featureSeed(f),
      h = resolveHeight(f, buildingArea(f.points), (seed % 1000) / 1000);
    const shift = Math.min(18, 2 + h.top * 0.045);
    c.beginPath();
    for (const ring of [f.points, ...(f.holes || [])]) {
      ring.forEach((p, i) =>
        i
          ? c.lineTo(p[0] + shift, p[1] + shift * 0.65)
          : c.moveTo(p[0] + shift, p[1] + shift * 0.65),
      );
      c.closePath();
    }
    c.fill("evenodd");
  }

  c.lineCap = "round";
  c.lineJoin = "round";
  for (const road of city.roads) {
    if (road.tags.tunnel === "yes") continue;
    const width = roadWidth(road.tags);
    if (width < 7) continue;
    c.beginPath();
    road.points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    c.strokeStyle =
      width >= 18 ? "rgba(219,170,98,.085)" : "rgba(192,161,100,.045)";
    c.lineWidth = width * 2.2;
    c.stroke();
  }
  return {
    bitmap: canvas.transferToImageBitmap(),
    a: snapshotPoint([x0, y0], city.center),
    b: snapshotPoint([x1, y1], city.center),
  };
}
