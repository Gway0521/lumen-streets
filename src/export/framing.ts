import type { FrameView } from "../engine/scene-engine.ts";
import type { Camera } from "../scene/recipe.ts";

export type ExportSize = "current" | "desktop" | "desktop1610" | "portrait";
export type ExportFormat = "png" | "gif" | "mp4" | "webm";
export interface ScreenDimensions { width: number; height: number }

/** Full display, not the browser viewport or screen.availHeight. Screen values
 * are CSS pixels; keep fractional pixels until the final format is rounded. */
export function screenDimensions(display: { width: number; height: number; orientation?: { type: string } } | undefined, pixelRatio = 1): ScreenDimensions | undefined {
  if (!display || ![display.width, display.height].every(n => Number.isFinite(n) && n > 0)) return;
  let { width, height } = display;
  const orientation = display.orientation?.type;
  if ((orientation?.startsWith("portrait") && width > height) || (orientation?.startsWith("landscape") && height > width))
    [width, height] = [height, width];
  const scale = Math.min(Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1, 3840 / Math.max(width, height));
  if (Math.min(width, height) * scale < 128) return;
  return { width: width * scale, height: height * scale };
}
export const VIDEO_LIMITS = Object.freeze({ fps: 30, durations: [30, 60, 120, 180, 300] as const, maxSeconds: 300, longEdge: 2560, bytes: 1_500_000_000, memoryBytes: 250_000_000 });
export function videoSeconds(value: number) {
  if (!Number.isInteger(value) || value < 15 || value > VIDEO_LIMITS.maxSeconds) throw new Error('Invalid video duration');
  return value;
}
export const GIF_LIMITS = Object.freeze({ seconds: 6, fps: 15, frames: 90, longEdge: 720, bytes: 25_000_000 });

/** Center-crop the visible world rectangle, retaining its original logical-pixel scale. */
export function cropView(source: FrameView, width: number, height: number): FrameView {
  if (![source.width, source.height, width, height].every(n => Number.isFinite(n) && n > 0))
    throw new Error("Invalid export viewport");
  const scale = Math.max(width / source.width, height / source.height);
  const w = width / scale, h = height / scale;
  const origin = source.origin ?? [source.width * (source.width > 760 && !source.quietMode ? 0.63 : 0.5), source.height * 0.5];
  return { ...source, width: w, height: h, dpr: scale, origin: [origin[0] - (source.width - w) / 2, origin[1] - (source.height - h) / 2] };
}

export function outputPlan(source: FrameView, size: ExportSize, format: ExportFormat, resolution: number = 1080, screen?: ScreenDimensions) {
  if (!["current", "desktop", "desktop1610", "portrait"].includes(size) || !["png", "gif", "mp4", "webm"].includes(format))
    throw new Error("Invalid export option");
  let [width, height] = size === "desktop" ? [3840, 2160] : size === "desktop1610" ? [3840, 2400] : size === "portrait" ? [1080, 1920] :
    screen ? [screen.width, screen.height] : [Math.round(source.width * (source.dpr ?? 1)), Math.round(source.height * (source.dpr ?? 1))];
  if (format === "png") { width = Math.round(width); height = Math.round(height); }
  if (format === "gif") {
    const scale = GIF_LIMITS.longEdge / Math.max(width, height);
    width = Math.round(width * scale); height = Math.round(height * scale);
  }
  if (format === "mp4" || format === "webm") {
    if (![1080,1440].includes(resolution)) throw new Error('Invalid video resolution');
    const scale = (resolution === 1440 ? 2560 : 1920) / Math.max(width, height);
    width = Math.round(width * scale / 2) * 2; height = Math.round(height * scale / 2) * 2;
  }
  if (![width, height].every(n => Number.isInteger(n) && n >= 128 && n <= 8192) || width * height > 16_000_000)
    throw new Error("Unsupported export dimensions");
  // Saved scene/player viewports stay independent of the viewing device.
  const view = size === "current" && format === "png" && !screen ? structuredClone(source) : cropView(source, width, height);
  return { width, height, view };
}

/** Fill the image from mapped bounds, keeping the requested camera center when possible.
 * Camera/viewport are copies; editor panel offsets never enter the wallpaper composition. */
export function wallpaperPlan(source: FrameView, bounds: readonly number[], camera: Camera, size: ExportSize, format: ExportFormat, resolution: number = 1080, screen?: ScreenDimensions) {
  const plan = outputPlan(source, size, format, resolution, screen);
  const view = { ...plan.view, origin: [plan.view.width / 2, plan.view.height / 2] as [number, number], labels: false, vignette: false, quietMode: true };
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || w <= 0 || h <= 0) throw new Error("Invalid scene bounds");
  const zoom = Math.max(camera.zoom, Math.max(view.width / w, view.height / h) * 1.002);
  const hx = view.width / (2 * zoom), hy = view.height / (2 * zoom);
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
  return { ...plan, view, camera: { zoom, x: clamp(camera.x, bounds[0] + hx, bounds[2] - hx), y: clamp(camera.y, bounds[1] + hy, bounds[3] - hy) } };
}

/** GIF delays are centiseconds; cumulative rounding makes 90 frames exactly 6 seconds. */
export function frameDelay(frame: number) {
  return (Math.round((frame + 1) * 100 / GIF_LIMITS.fps) - Math.round(frame * 100 / GIF_LIMITS.fps)) * 10;
}
