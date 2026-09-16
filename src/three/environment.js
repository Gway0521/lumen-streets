import earcut from "earcut";
import { localPoint } from "./geo.js";

/** Water/park masks and a bounded road-light field, decoded from existing tiles. */
export class EnvironmentBuilder {
  constructor(origin, bounds, mobile) {
    this.origin = origin;
    this.a = localPoint(bounds[0], bounds[3], origin);
    this.b = localPoint(bounds[2], bounds[1], origin);
    this.water = [];
    this.green = [];
    this.bridges = [];
    this.limit = mobile ? 90000 : 210000;
    const w = Math.max(1, this.b[0] - this.a[0]),
      h = Math.max(1, this.b[1] - this.a[1]);
    this.scale = (mobile ? 1024 : 2048) / Math.max(w, h);
    this.canvas = new OffscreenCanvas(
      Math.ceil(w * this.scale),
      Math.ceil(h * this.scale),
    );
    this.ctx = this.canvas.getContext("2d");
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.scale(this.scale, this.scale);
    this.ctx.translate(-this.a[0], -this.a[1]);
    this.mask = new OffscreenCanvas(this.canvas.width, this.canvas.height);
    this.maskCtx = this.mask.getContext("2d", { willReadFrequently: true });
    this.maskCtx.scale(this.scale, this.scale);
    this.maskCtx.translate(-this.a[0], -this.a[1]);
    this.maskCtx.globalCompositeOperation = "lighten";
    this.mobile = mobile;
    this.lamps = new Set();
    this.roadCells = new Map();
    this.shore = [];
    this.lampPoints = [];
  }
  addPolygon(f, kind) {
    const output = this[kind];
    if (output.length >= this.limit) return;
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    for (const rings of polygons) {
      this.maskPolygon(
        rings,
        kind === "water"
          ? "#0000ff"
          : f.properties?.class === "wood"
            ? "#00ff00"
            : f.properties?.class === "grass"
              ? "#ff0000"
              : "#005000",
      );
      const points = [],
        holes = [];
      for (const [index, ring] of rings.entries()) {
        if (index) holes.push(points.length);
        for (const p of ring) points.push(localPoint(...p, this.origin));
      }
      if (points.length < 3 || points.length > 20000) continue;
      const indices = earcut(points.flat(), holes, 2);
      if (output.length + indices.length * 3 > this.limit) continue;
      for (const index of indices)
        output.push(...points[index], kind === "water" ? 0.32 : 0.28);
      if (kind === "water")
        for (const ring of rings)
          for (let i = 1; i < ring.length; i++) {
            const a = localPoint(...ring[i - 1], this.origin),
              b = localPoint(...ring[i], this.origin),
              length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            for (let d = 25; d < length; d += 85)
              if (this.shore.length < 12000)
                this.shore.push([
                  a[0] + ((b[0] - a[0]) * d) / length,
                  a[1] + ((b[1] - a[1]) * d) / length,
                ]);
          }
    }
  }
  maskPolygon(rings, color) {
    const c = this.maskCtx;
    c.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const q = localPoint(...p, this.origin);
        i ? c.lineTo(...q) : c.moveTo(...q);
      });
      c.closePath();
    }
    c.fillStyle = color;
    c.fill("evenodd");
  }
  excludeBuilding(f) {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    for (const rings of polygons) this.maskPolygon(rings, "#0000ff");
  }
  addRoad(f) {
    if (f.properties.brunnel !== "tunnel") {
      const lines =
        f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiLineString"
            ? f.geometry.coordinates
            : [];
      const widths = {
        motorway: 29,
        trunk: 27,
        primary: 25,
        secondary: 20,
        tertiary: 15,
        minor: 11,
        residential: 11,
        street: 11,
        service: 8,
        path: 5,
        track: 5,
        footway: 5,
        cycleway: 5,
        rail: 6,
      };
      const width = widths[f.properties.class];
      if (width) {
        const c = this.maskCtx;
        c.strokeStyle = "#0000ff";
        c.lineWidth = width;
        c.lineCap = "round";
        c.lineJoin = "round";
        for (const line of lines) {
          c.beginPath();
          line.forEach((p, i) => {
            const q = localPoint(...p, this.origin);
            i ? c.lineTo(...q) : c.moveTo(...q);
          });
          c.stroke();
        }
      }
    }
    if (
      f.properties.brunnel === "tunnel" ||
      ![
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "minor",
        "residential",
        "street",
      ].includes(f.properties.class)
    )
      return;
    const lines =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = localPoint(...line[i - 1], this.origin),
          b = localPoint(...line[i], this.origin),
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (
          f.properties.brunnel === "bridge" &&
          length > 0.1 &&
          this.bridges.length < 75000
        ) {
          const width = ["motorway", "trunk", "primary", "secondary"].includes(
            f.properties.class,
          )
            ? 12
            : 7;
          const nx = (-(b[1] - a[1]) / length) * width,
            ny = ((b[0] - a[0]) / length) * width;
          const p = [a[0] + nx, a[1] + ny, 4, 1, 0],
            q = [a[0] - nx, a[1] - ny, 4, -1, 0],
            r = [b[0] - nx, b[1] - ny, 4, -1, length],
            s = [b[0] + nx, b[1] + ny, 4, 1, length];
          this.bridges.push(...p, ...q, ...r, ...p, ...r, ...s);
        }
        for (let d = 15; d < length; d += 70) {
          const x = a[0] + ((b[0] - a[0]) * d) / length,
            y = a[1] + ((b[1] - a[1]) * d) / length;
          if (
            x < this.a[0] - 30 ||
            x > this.b[0] + 30 ||
            y < this.a[1] - 30 ||
            y > this.b[1] + 30
          )
            continue;
          const key = `${Math.round(x / 20)}/${Math.round(y / 20)}`;
          if (this.lamps.has(key) || this.lamps.size >= 30000) continue;
          this.lamps.add(key);
          const side = Math.floor(d / 70) % 2 ? -1 : 1;
          const shoulder = [
            "motorway",
            "trunk",
            "primary",
            "secondary",
          ].includes(f.properties.class)
            ? 9
            : 4;
          this.lampPoints.push(
            x - ((b[1] - a[1]) / length) * shoulder * side,
            y + ((b[0] - a[0]) / length) * shoulder * side,
            f.properties.brunnel === "bridge" ? 5 : 2,
          );
          const cell = `${Math.floor(x / 160)}/${Math.floor(y / 160)}`;
          if (!this.roadCells.has(cell)) this.roadCells.set(cell, []);
          this.roadCells.get(cell).push([x, y]);
          const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, 8);
          gradient.addColorStop(0, "#ffffff");
          gradient.addColorStop(0.3, "#aaaaaa");
          gradient.addColorStop(1, "#00000000");
          this.ctx.fillStyle = gradient;
          this.ctx.fillRect(x - 8, y - 8, 16, 16);
        }
      }
  }
  consume(layers) {
    for (const f of layers.water || []) this.addPolygon(f, "water");
    for (const f of layers.park || []) this.addPolygon(f, "green");
    for (const f of layers.landcover || [])
      if (["wood", "grass"].includes(f.properties.class))
        this.addPolygon(f, "green");
    for (const f of layers.transportation || []) this.addRoad(f);
  }
  finish() {
    const seen = new Set();
    for (const [x, y] of this.shore) {
      const gx = Math.floor(x / 160),
        gy = Math.floor(y / 160),
        key = `${Math.round(x / 55)}/${Math.round(y / 55)}`;
      if (seen.has(key)) continue;
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++)
        for (let dy = -1; dy <= 1 && !near; dy++)
          near = (this.roadCells.get(`${gx + dx}/${gy + dy}`) || []).some(
            (p) => Math.hypot(p[0] - x, p[1] - y) < 155,
          );
      if (!near) continue;
      seen.add(key);
      // Give inferred shoreline reflections a visible source, within the same point budget.
      if (this.lampPoints.length < 90000) this.lampPoints.push(x, y, 1.6);
      const g = this.ctx.createRadialGradient(x, y, 0, x, y, 8);
      g.addColorStop(0, "#eeeeee");
      g.addColorStop(0.3, "#aaaaaa");
      g.addColorStop(1, "#00000000");
      this.ctx.fillStyle = g;
      this.ctx.fillRect(x - 8, y - 8, 16, 16);
    }
    // Pack coverage alongside the existing red-channel light field. Roads,
    // water and buildings exclude vegetation regardless of feature load order.
    const mask = this.maskCtx.getImageData(
      0,
      0,
      this.mask.width,
      this.mask.height,
    );
    const pixels = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 1] = mask.data[i + 1];
      pixels.data[i + 2] = mask.data[i + 2];
    }
    this.ctx.putImageData(pixels, 0, 0);
    const trees = [];
    const cap = this.mobile ? 2000 : 6000,
      step = Math.max(
        14,
        Math.sqrt(((this.b[0] - this.a[0]) * (this.b[1] - this.a[1])) / 180000),
      );
    const sample = (x, y, channel) => {
      const u = Math.floor((x - this.a[0]) * this.scale),
        v = Math.floor((y - this.a[1]) * this.scale);
      return u < 0 || v < 0 || u >= this.mask.width || v >= this.mask.height
        ? 0
        : mask.data[(v * this.mask.width + u) * 4 + channel];
    };
    const rnd = (x, y) => {
      const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const candidates = [];
    for (let x = Math.ceil(this.a[0] / step); x * step < this.b[0]; x++)
      for (let y = Math.ceil(this.a[1] / step); y * step < this.b[1]; y++) {
        const r = rnd(x, y),
          px = (x + 0.15 + r * 0.7) * step,
          py = (y + 0.15 + rnd(y, x + 71) * 0.7) * step;
        const wood = sample(px, py, 1) > 180;
        if (
          sample(px, py, 1) < 60 ||
          sample(px, py, 2) > 16 ||
          (!wood && sample(px, py, 0) > 128)
        )
          continue;
        // In parks without mapped woodland, suggest occasional groves rather than
        // treating the whole park as forest. Explicit grass remains open.
        if (
          !wood &&
          (rnd(Math.floor(px / 65), Math.floor(py / 65)) < 0.65 || r < 0.28)
        )
          continue;
        const radius = 3.3 + r * 2.1;
        if (
          [
            [radius + 2, 0],
            [-radius - 2, 0],
            [0, radius + 2],
            [0, -radius - 2],
          ].some(
            ([dx, dy]) =>
              sample(px + dx, py + dy, 2) > 16 ||
              sample(px + dx, py + dy, 1) < 60 ||
              (!wood && sample(px + dx, py + dy, 0) > 128),
          )
        )
          continue;
        candidates.push([px, py, 7 + rnd(x + 19, y) * 7, radius, r]);
      }
    const cx = (this.a[0] + this.b[0]) / 2,
      cy = (this.a[1] + this.b[1]) / 2;
    candidates.sort(
      (a, b) =>
        Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy),
    );
    for (const t of candidates.slice(0, cap)) trees.push(...t);
    return {
      water: new Float32Array(this.water),
      green: new Float32Array(this.green),
      bridges: new Float32Array(this.bridges),
      lamps: new Float32Array(this.lampPoints),
      trees: new Float32Array(trees),
      a: this.a,
      b: this.b,
      light: this.canvas.transferToImageBitmap(),
    };
  }
}
