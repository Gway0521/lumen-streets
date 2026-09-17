// @ts-check
import { sceneZoom } from "./view.js";
import { regions } from "../shared/regions.js";
import { detailLevel, geometryKey } from "./geo.js";

/** One geometry job in flight, one coalesced successor; no unbounded build queue. */
export class CityStream {
  constructor(map, layer, { mobile, status, city, sources = (..._args) => {} }) {
    this.map = map;
    this.layer = layer;
    this.mobile = mobile;
    this.status = status;
    this.city = city;
    this.generation = 0;
    this.busy = false;
    this.pending = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined;
    this.metrics = { builds: 0, completed: 0, failed: 0, cancelled: 0, lastBuildMs: 0 };
    this.locked = false;
    this.lastKey = "";
    this.worker = new Worker(new URL("./city.worker.js", import.meta.url), {
      type: "module",
    });
    /** @param {MessageEvent<import("./contracts.ts").WorkerResult>} event */
    this.worker.onmessage = ({ data }) => {
      this.busy = false;
      this.metrics.lastBuildMs = performance.now() - (this.started || performance.now());
      if (
        data.generation === this.generation &&
        !this.locked &&
        detailLevel(sceneZoom(map)) !== "map"
      ) {
        if (data.cancelled) {
          this.metrics.cancelled++;
          this.lastKey = "";
        } else if (data.error !== undefined) {
          this.metrics.failed++;
          this.lastError = data.error;
          this.status("geometryError");
          this.lastKey = "";
        } else {
          this.metrics.completed++;
          this.lastError = null;
          layer.replace(data);
          sources(data.geometry.heightAttribution || [], data.geometry.heightStatus);
          clearTimeout(this.refreshTimer);
          if (data.geometry.heightPending || data.geometry.heightStatus?.includes("partial")) this.refreshTimer = setTimeout(() => { this.lastKey = ""; this.refresh = true; this.schedule(); }, data.geometry.heightPending ? 30000 : 3600000);
          this.status(data.geometry.tileLimited ? "budget" : "ready");
          this.ready = true;
        }
      } else {
        this.metrics.cancelled++;
        data.surface?.bitmap.close();
        data.environment?.light.close();
        // A discarded job never fulfilled its key. Identical camera events
        // (including another + at max zoom) must still be able to retry it.
        this.lastKey = "";
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
    this.moved = () => {
      if (this.busy) {
        this.generation++;
        this.pending = true;
        this.worker.postMessage({ type: "cancel" });
      }
      this.schedule();
    };
    map.on("moveend", this.moved);
    map.on("sourcedata", this.changed);
    this.zoomed = () => {
      if (detailLevel(sceneZoom(map)) === "map") {
        this.generation++;
        clearTimeout(this.refreshTimer);
        this.layer.clear();
        sources([]);
        this.lastKey = "";
        this.worker.postMessage({ type: "clear" });
        this.status("map");
      }
    };
    map.on("zoomend", this.zoomed);
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.build();
    }, 450);
  }
  // ready describes the last build; a debounced rebuild may still be queued.
  get settled() {
    return !!this.ready && !this.busy && !this.pending && this.timer === undefined;
  }
  retry() {
    if (this.locked) return;
    clearTimeout(this.refreshTimer);
    this.lastError = null;
    this.lastKey = "";
    this.generation++;
    if (this.busy) {
      this.pending = true;
      this.worker.postMessage({ type: "cancel" });
    }
    this.schedule();
  }
  setCity(id) {
    this.city = id;
    this.retry();
  }
  build() {
    if (this.locked || detailLevel(sceneZoom(this.map)) === "map") return;
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
    const roads = gather("transportation", this.mobile ? 1500 : 3500);
    const city =
      regions[this.city] && within(regions[this.city].center)
        ? this.city
        : null;
    /** @type {import("./contracts.ts").Bounds} */
    const viewport = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const key = `${city}:${viewport.map((n) => n.toFixed(3))}:${Math.floor(sceneZoom(this.map) * 4)}:${roads.length}:${roads.at(-1)?.id}`;
    if (this.lastKey === key) return;
    clearTimeout(this.refreshTimer);
    this.lastKey = key;
    this.busy = true;
    this.started = performance.now();
    this.metrics.builds++;
    this.ready = false;
    this.status("loading");
    /** @type {import("./contracts.ts").BuildRequest} */
    const request = {
      type: "build",
      generation: this.generation,
      city,
      center,
      roads,
      bounds: viewport,
      tileURL: new URL(
        import.meta.env.VITE_LUMEN_TILEJSON_URL ||
          "https://tiles.openfreemap.org/planet",
        location.href,
      ).href,
      heightURL: new URL("/api/buildings/manifest.json", location.href).href,
      refreshHeights: this.refresh,
      mobile: this.mobile,
      zoom: sceneZoom(this.map),
      surfaceKey: this.layer.surfaceKey,
      base: new URL(import.meta.env.BASE_URL, location.href).href,
      limit: this.mobile ? 280000 : 700000,
    };
    this.worker.postMessage(request);
    this.refresh = false;
  }
  dispose() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.worker.terminate();
    this.map.off("moveend", this.moved);
    this.map.off("sourcedata", this.changed);
    this.map.off("zoomend", this.zoomed);
  }
}
