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
  addRoad(f) {
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
    return {
      water: new Float32Array(this.water),
      green: new Float32Array(this.green),
      bridges: new Float32Array(this.bridges),
      lamps: new Float32Array(this.lampPoints),
      a: this.a,
      b: this.b,
      light: this.canvas.transferToImageBitmap(),
    };
  }
}
