import { regions } from "../city.js";
import { detailLevel, geometryKey, localPoint } from "./geo.js";

/** One geometry job in flight, one coalesced successor; no unbounded build queue. */
export class CityStream {
  constructor(map, layer, { mobile, status, city }) {
    this.map = map;
    this.layer = layer;
    this.mobile = mobile;
    this.status = status;
    this.city = city;
    this.generation = 0;
    this.busy = false;
    this.pending = false;
    this.locked = false;
    this.lastKey = "";
    this.worker = new Worker(new URL("./city.worker.js", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => {
      this.busy = false;
      if (
        data.generation === this.generation &&
        !this.locked &&
        detailLevel(map.getZoom()) !== "map"
      ) {
        if (data.error) {
          this.lastError = data.error;
          this.status("geometryError");
          this.lastKey = "";
          if (import.meta.env.DEV) console.error(data.error);
        } else {
          layer.replace(data);
          map.setLayoutProperty("building-fallback", "visibility", "none");
          this.status(data.geometry.truncated ? "budget" : "ready");
          this.ready = true;
        }
      }
      if (this.pending) {
        this.pending = false;
        this.schedule();
      }
    };
    this.worker.onerror = (e) => {
      this.busy = false;
      this.lastError = e.message;
      this.lastKey = "";
      this.status("geometryError");
      if (import.meta.env.DEV) console.error(e.message);
    };
    this.changed = () => this.schedule();
    this.moved = () => this.schedule();
    map.on("moveend", this.moved);
    map.on("sourcedata", this.changed);
    this.zoomed = () => {
      if (detailLevel(map.getZoom()) === "map") {
        this.generation++;
        this.layer.clear();
        this.lastKey = "";
        this.status("map");
      }
    };
    map.on("zoomend", this.zoomed);
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.build(), 450);
  }
  setCity(id) {
    this.city = id;
    this.generation++;
    this.lastKey = "";
    this.schedule();
  }
  build() {
    if (this.locked || detailLevel(this.map.getZoom()) === "map") return;
    if (this.busy) {
      this.pending = true;
      return;
    }
    const center = this.map.getCenter().toArray(),
      bounds = this.map.getBounds();
    const within = (coordinates) => {
      const p = coordinates;
      return (
        p &&
        Number.isFinite(p[0]) &&
        p[0] >= bounds.getWest() - 0.02 &&
        p[0] <= bounds.getEast() + 0.02 &&
        p[1] >= bounds.getSouth() - 0.02 &&
        p[1] <= bounds.getNorth() + 0.02
      );
    };
    const gather = (sourceLayer, max) => {
      const found = new Map();
      for (const f of this.map.querySourceFeatures("world", { sourceLayer })) {
        const data = f.toJSON(),
          g = data.geometry;
        const p =
          g.type === "Polygon"
            ? g.coordinates[0]?.[0]
            : g.type === "MultiPolygon"
              ? g.coordinates[0]?.[0]?.[0]
              : g.type === "MultiLineString"
                ? g.coordinates[0]?.[0]
                : g.coordinates[0];
        if (!within(p)) continue;
        const key = geometryKey(data);
        if (!found.has(key))
          found.set(key, {
            id: data.id,
            geometry: g,
            properties: data.properties,
          });
        if (found.size >= max) break;
      }
      return [...found.values()];
    };
    const buildings = gather("building", this.mobile ? 4500 : 12000),
      roads = gather("transportation", this.mobile ? 1500 : 3500);
    const city =
      regions[this.city] &&
      Math.hypot(...localPoint(...center, regions[this.city].center)) < 2700
        ? this.city
        : null;
    if (!city && !this.map.isSourceLoaded("world")) {
      this.status("loading");
      return;
    }
    const key = `${city}:${center.map((n) => n.toFixed(3))}:${buildings.length}:${roads.length}:${buildings.at(-1)?.id}:${roads.at(-1)?.id}`;
    if (this.lastKey === key) return;
    this.lastKey = key;
    this.busy = true;
    this.ready = false;
    this.status("loading");
    this.worker.postMessage({
      type: "build",
      generation: this.generation,
      city,
      center,
      buildings,
      roads,
      base: new URL(import.meta.env.BASE_URL, location.href).href,
      limit: this.mobile ? 280000 : 700000,
    });
  }
  dispose() {
    clearTimeout(this.timer);
    this.worker.terminate();
    this.map.off("moveend", this.moved);
    this.map.off("sourcedata", this.changed);
    this.map.off("zoomend", this.zoomed);
  }
}
