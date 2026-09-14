import { renderAtlas } from "../city.js";
import { buildGraph, Traffic } from "../traffic.js";
import { createFramePainter } from "./frame.js";
import type { SceneData } from "../scene/data.ts";
import { validateAppearance, type Appearance } from "../scene/appearance.ts";
import type { StructureRecipe } from '../scene/structures.ts';
import {
  validateRecipe,
  STEP,
  type SceneRecipe,
  type Camera,
  type Palette,
} from "../scene/recipe.ts";

export interface FrameView {
  width: number;
  height: number;
  dpr?: number;
  origin?: [number, number];
  quietMode?: boolean;
  locale?: "en" | "zh-TW";
  labels?: boolean;
  vignette?: boolean;
  brightness?: number;
}
type Atlas = ReturnType<typeof renderAtlas>;
function releaseAtlas(atlas: Atlas) {
  atlas.canvas.width = atlas.canvas.height = 0;
  if ('foreground' in atlas && atlas.foreground) atlas.foreground.width = atlas.foreground.height = 0;
}
interface Resources {
  atlas?: (data: SceneData, palette: Palette, appearance?: Appearance, structures?: StructureRecipe) => Atlas;
  painter?: typeof createFramePainter;
}

/** Owns mutable state and disposable canvas resources; only frozen source geometry is shared. */
export class SceneEngine {
  readonly data: SceneData;
  #recipe: SceneRecipe;
  #traffic: Traffic;
  #atlas: Atlas;
  #painter: ReturnType<typeof createFramePainter>;
  #disposed = false;
  #resources: Resources;

  constructor(data: SceneData, recipe: SceneRecipe, resources: Resources = {}) {
    if (data.schemaVersion !== 1)
      throw new Error("Unsupported scene data version");
    this.data = data;
    this.#recipe = validateRecipe(recipe, data);
    this.#resources = resources;
    this.#traffic = new Traffic(buildGraph(data.geometry), recipe.seed);
    if (this.#recipe.checkpoint) {
      this.#traffic.restore(this.#recipe.checkpoint);
      const expected = this.#traffic.spawnEdges.length ? this.carCount : 0;
      if (this.#traffic.cars.length !== expected)
        throw new Error("Invalid checkpoint vehicle count");
    } else {
      this.#traffic.setCount(this.carCount);
      const steps = Math.round(recipe.simulationTime / STEP);
      if (Math.abs(steps * STEP - recipe.simulationTime) > 1e-7)
        throw new Error("Scene time must use fixed simulation steps");
      for (let i = 0; i < steps; i++) this.#traffic.update(STEP);
    }
    delete this.#recipe.checkpoint;
    this.#atlas = resources.atlas
      ? resources.atlas(data, recipe.palette, this.#recipe.appearance, this.#recipe.structures)
      : renderAtlas(data.geometry, recipe.palette, this.#recipe.appearance, this.#recipe.structures);
    try {
      this.#painter = (resources.painter ?? createFramePainter)();
    } catch (error) {
      releaseAtlas(this.#atlas);
      throw error;
    }
  }
  #assertAlive() {
    if (this.#disposed) throw new Error("Scene engine has been disposed");
  }
  private get carCount() {
    return (
      this.#recipe.trafficCount ??
      Math.round(
        ((this.data.id === "ntu" ? 850 : 1100) * this.#recipe.density) / 100,
      )
    );
  }
  get camera(): Camera {
    return { ...this.#recipe.camera };
  }
  get projection(): number[] {
    return 'projection' in this.#atlas ? [...this.#atlas.projection] : [1,0,0,1];
  }
  get playing(): boolean {
    return this.#recipe.playing;
  }
  set playing(value: boolean) {
    this.#assertAlive();
    this.#recipe.playing = value;
  }
  get time(): number {
    return this.#traffic.time;
  }
  get vehicleCount(): number {
    return this.#traffic.cars.length;
  }
  setCamera(camera: Camera) {
    this.#assertAlive();
    if (
      ![camera.x, camera.y, camera.zoom].every(Number.isFinite) ||
      camera.zoom < 0.001 ||
      camera.zoom > 10 ||
      Math.abs(camera.x) > 100_000 ||
      Math.abs(camera.y) > 100_000
    )
      throw new Error("Invalid camera");
    this.#recipe.camera = { ...camera };
  }
  setPalette(palette: Palette) {
    this.#assertAlive();
    if (!["aerial", "amber", "blue"].includes(palette))
      throw new Error("Invalid palette");
    if (palette === this.#recipe.palette) return;
    const next = this.#resources.atlas
      ? this.#resources.atlas(this.data, palette, this.#recipe.appearance, this.#recipe.structures)
      : renderAtlas(this.data.geometry, palette, this.#recipe.appearance, this.#recipe.structures);
    releaseAtlas(this.#atlas);
    this.#atlas = next;
    this.#recipe.palette = palette;
  }
  setDensity(density: number) {
    this.#assertAlive();
    if (!Number.isFinite(density) || density < 0 || density > 100)
      throw new Error("Invalid traffic density");
    this.#recipe.density = density;
    delete this.#recipe.trafficCount;
    this.#traffic.setCount(this.carCount);
    if (!this.playing)
      this.#traffic.cars.forEach((car) => {
        car.age = Math.max(2, car.age);
      });
  }
  setAppearance(value: Appearance) {
    this.#assertAlive();
    const next = validateAppearance(value), old = this.#recipe.appearance!;
    if (this.#recipe.palette === "aerial" && (next.glow !== old.glow || next.district !== old.district)) {
      const atlas = this.#resources.atlas ? this.#resources.atlas(this.data, this.#recipe.palette, next, this.#recipe.structures) : renderAtlas(this.data.geometry, this.#recipe.palette, next, this.#recipe.structures);
      releaseAtlas(this.#atlas);
      this.#atlas = atlas;
    }
    this.#recipe.appearance = next;
  }
  setRail(trains: boolean, underground: boolean) {
    this.#assertAlive();
    this.#recipe.trains = trains;
    this.#recipe.underground = underground;
  }
  /** Fixed simulation steps keep results independent of animation-frame scheduling. */
  advance(seconds: number) {
    this.#assertAlive();
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)
      throw new Error("Invalid time step");
    let remaining = this.#recipe.remainder + seconds;
    while (remaining + 1e-10 >= STEP) {
      this.#traffic.update(STEP);
      remaining -= STEP;
    }
    this.#recipe.remainder = Math.max(0, remaining);
  }
  snapshot(): SceneRecipe {
    this.#assertAlive();
    return {
      ...structuredClone(this.#recipe),
      simulationTime: this.time,
      checkpoint: this.#traffic.snapshot(),
    };
  }
  render(ctx: CanvasRenderingContext2D, view: FrameView) {
    this.#assertAlive();
    const r = this.#recipe;
    ctx.save();
    try {
      this.#painter.render(
        ctx,
        {
          city: this.data.geometry,
          atlas: this.#atlas,
          traffic: this.#traffic,
          camera: r.camera,
          mood: r.palette,
          trains: r.trains,
          xray: r.underground,
        },
        { ...view, labels: view.labels ?? r.appearance!.labels, brightness: r.appearance!.brightness },
      );
    } finally {
      ctx.restore();
    }
  }
  /** Copy the expensive, unchanging atlas instead of painting it again during a capture. */
  fork(recipe = this.snapshot()): SceneEngine {
    this.#assertAlive();
    const currentPalette = this.#recipe.palette;
    let initial = true;
    return new SceneEngine(this.data, recipe, {
      ...this.#resources,
      atlas: (data, palette, appearance, structures) => {
        if (initial && palette === currentPalette && JSON.stringify(structures) === JSON.stringify(this.#recipe.structures) && JSON.stringify(validateAppearance(appearance)) === JSON.stringify(this.#recipe.appearance)) {
          initial = false;
          const copy = (source: HTMLCanvasElement) => {
            const canvas = document.createElement("canvas");
            canvas.width = source.width; canvas.height = source.height;
            try {
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new Error("Canvas 2D unavailable");
              ctx.drawImage(source, 0, 0); return canvas;
            } catch (error) { canvas.width = canvas.height = 0; throw error; }
          };
          const canvas = copy(this.#atlas.canvas);
          try {
            const foreground = 'foreground' in this.#atlas && this.#atlas.foreground ? copy(this.#atlas.foreground) : undefined;
            const foregroundBounds = 'foregroundBounds' in this.#atlas ? [...this.#atlas.foregroundBounds] : undefined;
            return { ...this.#atlas, bounds: [...this.#atlas.bounds], foregroundBounds, canvas, foreground };
          } catch (error) { canvas.width = canvas.height = 0; throw error; }
        }
        initial = false;
        return renderAtlas(data.geometry, palette, appearance, structures);
      },
    });
  }
  dispose() {
    if (this.#disposed) return;
    releaseAtlas(this.#atlas);
    this.#painter.dispose();
    this.#traffic.cars.length = 0;
    this.#disposed = true;
  }
}
