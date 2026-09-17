import { renderAerial } from "./aerial.js";
import { random } from "./shared/random.js";
import { area, inside } from "./shared/geometry.js";
import { roadWidth } from "./shared/roads.js";
import { parseCity } from "./shared/city-data.js";
export { random } from "./shared/random.js";
export { project, area, inside, assembleRings } from "./shared/geometry.js";
export { roadWidth } from "./shared/roads.js";
export { regions } from "./shared/regions.js";
export { parseCity } from "./shared/city-data.js";
export async function loadCity(id) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${id}.json`);
  if (!response.ok) throw new Error("地圖資料暫時無法載入。");
  return parseCity(await response.json(), id);
}
const palettes = {
  amber: {
    ground: "#101c24",
    roof: ["#27343b", "#2b373c", "#303c40", "#24353b", "#354043", "#313a3b"],
    road: "#111c24",
    curb: "#2c383e",
    park: "#142e29",
    water: "#122b38",
    glow: "238,179,104",
  },
  blue: {
    ground: "#101f2d",
    roof: ["#2a3f50", "#304456", "#354853", "#2b404c", "#3a4b56", "#2c424e"],
    road: "#14232f",
    curb: "#344854",
    park: "#173c35",
    water: "#123f51",
    glow: "228,185,120",
  },
};
function path(c, pts, close = true, holes = []) {
  c.beginPath();
  for (const ring of [pts, ...holes]) {
    ring.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
    if (close) c.closePath();
  }
}
function glow(c, x, y, r, color, strength) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color},${strength})`);
  g.addColorStop(0.25, `rgba(${color},${strength * 0.4})`);
  g.addColorStop(1, `rgba(${color},0)`);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}
export function renderAtlas(city, mood = "amber", appearance, structures) {
  if (mood === "aerial") return renderAerial(city, appearance, structures);
  const p = palettes[mood],
    bounds = city.bounds,
    w = bounds[2] - bounds[0],
    h = bounds[3] - bounds[1],
    resolution = Math.min(1.6, 3600 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * resolution);
  canvas.height = Math.ceil(h * resolution);
  // Rasterize the static atlas without a large mobile GPU command buffer.
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.scale(resolution, resolution);
  c.translate(-bounds[0], -bounds[1]);
  c.fillStyle = p.ground;
  c.fillRect(bounds[0], bounds[1], w, h);
  for (const f of city.land) {
    path(c, f.points, true, f.holes);
    c.fillStyle =
      f.tags.natural === "water" || f.tags.waterway ? p.water : p.park;
    c.fill("evenodd");
    if (f.tags.leisure === "pitch") {
      c.strokeStyle = "#63816d32";
      c.lineWidth = 1;
      c.stroke();
    }
    if (!f.tags.waterway && f.tags.natural !== "water") {
      const r = random(f.id),
        xs = f.points.map((p) => p[0]),
        ys = f.points.map((p) => p[1]),
        minx = Math.min(...xs),
        maxx = Math.max(...xs),
        miny = Math.min(...ys),
        maxy = Math.max(...ys);
      for (let i = 0; i < Math.min(140, area(f.points) / 240); i++) {
        const v = [minx + r() * (maxx - minx), miny + r() * (maxy - miny)];
        if (!inside(v, f.points)) continue;
        c.fillStyle = i % 2 ? "#1c3930" : "#203d32";
        c.beginPath();
        c.arc(...v, 2 + r() * 3, 0, Math.PI * 2);
        c.fill("evenodd");
      }
    }
  }
  const surfaceRoads = city.roads.filter((f) => f.tags.tunnel !== "yes");
  c.lineJoin = "round";
  c.lineCap = "round";
  for (const f of surfaceRoads) {
    const width = roadWidth(f.tags);
    if (width < 5) continue;
    path(c, f.points, false);
    c.lineWidth = width + 2;
    c.strokeStyle = p.curb;
    c.stroke();
  }
  for (const f of surfaceRoads) {
    const width = roadWidth(f.tags);
    path(c, f.points, false);
    c.lineWidth = width;
    c.strokeStyle = width < 5 ? "#47615535" : p.road;
    c.stroke();
  }
  for (const f of surfaceRoads) {
    const width = roadWidth(f.tags);
    if (width < 14) continue;
    path(c, f.points, false);
    c.lineWidth = 0.6;
    c.setLineDash([4, 6]);
    c.strokeStyle = "#bda87937";
    c.stroke();
    c.setLineDash([]);
    let remaining = 18;
    for (let k = 1; k < f.points.length; k++) {
      const a = f.points[k - 1],
        b = f.points[k],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      for (let d = remaining; d < len; d += 58) {
        const t = d / len;
        for (const s of [-1, 1]) {
          const x = a[0] + dx * t - (dy / len) * width * 0.5 * s,
            y = a[1] + dy * t + (dx / len) * width * 0.5 * s;
          glow(c, x, y, 20, p.glow, 0.14);
          c.fillStyle = "#edcf965e";
          c.fillRect(x - 0.55, y - 0.55, 1.1, 1.1);
        }
      }
      remaining = (remaining - len) % 58;
      if (remaining < 0) remaining += 58;
    }
  }
  for (const f of city.buildings) {
    const r = random(f.id),
      ar = area(f.points);
    if (ar < 8) continue;
    c.save();
    c.translate(4, 7);
    path(c, f.points, true, f.holes);
    c.fillStyle = "#02080c95";
    c.fill("evenodd");
    c.restore();
    path(c, f.points, true, f.holes);
    c.fillStyle =
      f.tags["roof:colour"] === "gold"
        ? "#77623e"
        : p.roof[Math.floor(r() * p.roof.length)];
    c.fill("evenodd");
    c.strokeStyle = "#74808030";
    c.lineWidth = 0.85;
    c.stroke();
    c.save();
    path(c, f.points, true, f.holes);
    c.clip("evenodd");
    const xs = f.points.map((p) => p[0]),
      ys = f.points.map((p) => p[1]),
      minx = Math.min(...xs),
      maxx = Math.max(...xs),
      miny = Math.min(...ys),
      maxy = Math.max(...ys),
      cx = (minx + maxx) / 2,
      cy = (miny + maxy) / 2;
    if (ar > 150) {
      const inset = Math.min(5, (maxx - minx) / 6, (maxy - miny) / 6);
      c.strokeStyle = "#95a19916";
      c.lineWidth = 1.2;
      c.strokeRect(
        minx + inset,
        miny + inset,
        maxx - minx - inset * 2,
        maxy - miny - inset * 2,
      );
      if (inside([cx, cy], f.points)) {
        c.fillStyle = "#09151d64";
        c.fillRect(cx - 4, cy - 2, 10, 7);
        c.fillStyle = "#65727259";
        c.fillRect(cx - 4, cy - 3, 8, 5);
        if (ar > 1200) {
          c.fillStyle = "#62787e38";
          c.fillRect(cx - 13, cy + 7, 17, 5);
          c.strokeStyle = "#0d1e2799";
          c.lineWidth = 0.7;
          for (let j = 0; j < 5; j++) {
            c.beginPath();
            c.moveTo(cx - 12 + j * 3, cy + 7);
            c.lineTo(cx - 12 + j * 3, cy + 12);
            c.stroke();
          }
        }
      }
    }
    if (ar > 600) {
      const shade = c.createLinearGradient(minx, miny, maxx, maxy);
      shade.addColorStop(0, "#b4c4c619");
      shade.addColorStop(0.5, "#71899103");
      shade.addColorStop(1, "#010b1355");
      c.fillStyle = shade;
      c.fillRect(minx, miny, maxx - minx, maxy - miny);
      const ww = maxx - minx,
        hh = maxy - miny;
      c.strokeStyle = "#adbfc21a";
      c.lineWidth = 0.7;
      for (let j = 0; j < Math.min(10, ww / 14); j++) {
        const x = minx + 8 + j * 14;
        c.beginPath();
        c.moveTo(x, miny + 6);
        c.lineTo(x, maxy - 6);
        c.stroke();
      }
      for (let j = 0; j < Math.min(7, ar / 1100); j++) {
        const x = minx + 8 + r() * Math.max(0, ww - 22),
          y = miny + 8 + r() * Math.max(0, hh - 22);
        c.fillStyle = "#06121b77";
        c.fillRect(x + 1, y + 2, 7, 10);
        c.fillStyle = j % 2 ? "#53707766" : "#63757566";
        c.fillRect(x, y, 7, 9);
        c.strokeStyle = "#172b3488";
        c.lineWidth = 0.6;
        for (let k = 2; k < 8; k += 2) {
          c.beginPath();
          c.moveTo(x + 1, y + k);
          c.lineTo(x + 6, y + k);
          c.stroke();
        }
      }
      if (f.tags.name === "台北101") {
        for (let j = 0; j < 5; j++) {
          const d = 12 + j * 6;
          c.strokeStyle = j % 2 ? "#64bda94d" : "#a1c2aa55";
          c.lineWidth = 2;
          c.strokeRect(cx - d, cy - d, d * 2, d * 2);
        }
        glow(c, cx, cy, 35, "103,198,165", 0.14);
      }
    }
    c.restore();
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1],
        b = f.points[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = Math.hypot(dx, dy);
      if (len < 4) continue;
      const active =
        f.tags.building === "commercial" || f.tags.shop || ar > 2000;
      for (let d = 3; d < len - 2; d += 5.4) {
        if (r() > (active ? 0.62 : 0.29)) continue;
        c.strokeStyle = r() > 0.2 ? "#e6b474b0" : "#b8d3cd65";
        c.lineWidth = 1.3;
        c.beginPath();
        c.moveTo(a[0] + (dx * d) / len, a[1] + (dy * d) / len);
        c.lineTo(a[0] + (dx * (d + 2.3)) / len, a[1] + (dy * (d + 2.3)) / len);
        c.stroke();
      }
      if (active && i % 3 === 0)
        glow(c, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 16, p.glow, 0.1);
    }
  }
  const r = random(801);
  for (let i = 0; i < 26000; i++) {
    c.fillStyle = i % 2 ? "#ffffff05" : "#00000010";
    c.fillRect(bounds[0] + r() * w, bounds[1] + r() * h, 0.8, 0.8);
  }
  return { canvas, bounds, resolution };
}
