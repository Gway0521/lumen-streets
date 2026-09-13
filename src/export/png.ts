import { ensureTitleFonts } from "./title-fonts.ts";
import type { SceneEngine, FrameView } from "../engine/scene-engine.ts";

export interface PNGOptions {
  mode: "view" | "study";
  width: number;
  height: number;
  view: FrameView;
  title: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Optional visible source credit. Clean wallpaper is the default; the host presents provenance. */
  includeCredit?: boolean;
  placeTitle?: PlaceTitle;
  quietSpace?: QuietSpace;
}

export interface QuietSpace { edge: 'none' | 'left' | 'right' | 'top' | 'bottom'; strength: number }
export function validateQuietSpace(value: QuietSpace): QuietSpace {
  if (!value || !['none','left','right','top','bottom'].includes(value.edge) ||
      typeof value.strength !== 'number' || !Number.isFinite(value.strength) || value.strength < 0 || value.strength > 1)
    throw new Error('Invalid quiet space');
  return { edge: value.edge, strength: value.strength };
}
/** A broad, smooth shadow lowers both static detail and moving lights in the icon area. */
export function paintQuietSpace(ctx: CanvasRenderingContext2D, width: number, height: number, value: QuietSpace) {
  const { edge, strength } = validateQuietSpace(value); if (edge === 'none' || !strength) return;
  const horizontal = edge === 'left' || edge === 'right', reverse = edge === 'right' || edge === 'bottom';
  const extent = (horizontal ? width : height) * .62, start = reverse ? (horizontal ? width : height) : 0;
  const end = start + (reverse ? -extent : extent);
  const gradient = horizontal ? ctx.createLinearGradient(start,0,end,0) : ctx.createLinearGradient(0,start,0,end);
  // Zero slope at the edge and at the clear city, with no visible band or frame-by-frame sampling.
  for(let i=0;i<=16;i++) { const t=i/16, fade=1-t*t*(3-2*t); gradient.addColorStop(t,`rgba(5,11,17,${strength*fade})`); }
  ctx.save(); ctx.fillStyle=gradient; ctx.fillRect(0,0,width,height); ctx.restore();
}

export interface PlaceTitle { text: string; corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; size: 'small' | 'medium' | 'large' }
export function validatePlaceTitle(value: PlaceTitle): PlaceTitle {
  if (!value || typeof value.text !== 'string' || value.text.length > 120 || /[\u0000-\u001f\u007f]/.test(value.text) ||
      !['top-left','top-right','bottom-left','bottom-right'].includes(value.corner) || !['small','medium','large'].includes(value.size))
    throw new Error('Invalid place title');
  return { text: value.text.trim(), corner: value.corner, size: value.size };
}
export function paintPlaceTitle(ctx: CanvasRenderingContext2D, width: number, height: number, value: PlaceTitle, bottom = height) {
  const title = validatePlaceTitle(value); if (!title.text) return;
  const unit = Math.min(width, height) / 1080, pad = 64 * unit;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title.text);
  const size = ({ small: 29, medium: 38, large: 49 })[title.size] * unit * (cjk ? .82 : 1);
  const maxWidth = Math.min(width - pad * 2, Math.max(width * .55, 420 * unit));
  ctx.save(); ctx.font = `500 ${size}px "Cormorant Garamond", "Noto Serif TC", serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * (cjk ? .12 : .055)}px`;
  const lines: string[] = []; let line = '';
  // Keep Latin words together; split very long tokens and CJK at code-point boundaries.
  for (const word of title.text.match(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    if (line && ctx.measureText(line + word).width > maxWidth) { lines.push(line.trim()); line = ''; }
    for (const char of word) {
      if (!line && /\s/.test(char)) continue;
      if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line.trim());
  if (lines.length > 3) { lines.length = 3; const last = [...lines[2]]; while (last.length && ctx.measureText(last.join('') + '…').width > maxWidth) last.pop(); lines[2] = last.join('') + '…'; }
  const right = title.corner.endsWith('right'), top = title.corner.startsWith('top');
  const lineHeight = size * 1.5, blockHeight = lines.length * lineHeight;
  const x = right ? width-pad : pad, y = top ? pad + 19 * unit : bottom - pad - blockHeight;
  const textWidth = Math.max(...lines.map(text => ctx.measureText(text).width));
  // Elliptical local shade has no rectangular edge; it lets the caption settle into busy streets.
  ctx.save(); ctx.translate(right ? width : 0, y + blockHeight/2);
  ctx.scale(Math.max(210*unit,textWidth+pad*2), Math.max(150*unit,blockHeight*1.8));
  const shade=ctx.createRadialGradient(0,0,0,0,0,1);
  shade.addColorStop(0,'rgba(5,11,17,.74)'); shade.addColorStop(.42,'rgba(5,11,17,.5)'); shade.addColorStop(1,'rgba(5,11,17,0)');
  ctx.fillStyle=shade; ctx.fillRect(-1,-1,2,2); ctx.restore();
  ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#d9d3c3'; ctx.shadowColor = '#02080dbb'; ctx.shadowBlur = 3 * unit; ctx.shadowOffsetY = unit;
  lines.forEach((text,i) => ctx.fillText(text, x, y+i*lineHeight)); ctx.restore();
}

/** Attribution uses measured lines so narrow portrait images cannot clip the license. */
export function attribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  source: string,
) {
  const resolutionScale = Math.max(1, Math.min(width / 1600, height / 1200));
  const size = Math.max(13, Math.min(18, width / 40)) * resolutionScale;
  const pad = Math.min(28, width * 0.04) * resolutionScale,
    lineHeight = size * 1.45;
  ctx.font = `${size}px system-ui`;
  const lines: string[] = [];
  for (const text of [source]) {
    let line = "";
    for (const char of text) {
      if (line && ctx.measureText(line + char).width > width - 2 * pad) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  const top = height - lines.length * lineHeight - (2 * pad) / 3;
  ctx.fillStyle = "#09131de6";
  ctx.fillRect(0, top, width, height - top);
  ctx.fillStyle = "#c9d0c9";
  ctx.textBaseline = "top";
  lines.forEach((line, i) =>
    ctx.fillText(line, pad, top + pad / 3 + i * lineHeight),
  );
  return top;
}

/** Shared final composition for PNG, GIF frames and the crop preview. */
export function paintCapture(
  engine: SceneEngine,
  canvas: HTMLCanvasElement,
  options: Pick<PNGOptions, "width" | "height" | "view" | "title" | "includeCredit" | "placeTitle" | "quietSpace">,
  previewScale = 1,
  alpha = false,
) {
  const ctx = canvas.getContext("2d", { alpha });
  if (!ctx) throw new Error("Canvas 2D unavailable");
  engine.render(ctx, { ...options.view, dpr: (options.view.dpr ?? 1) * previewScale });
  ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
  if (options.quietSpace) paintQuietSpace(ctx, options.width, options.height, options.quietSpace);
  const bottom = options.includeCredit ? attribution(ctx, options.width, options.height, options.title, engine.data.source.attribution) : options.height;
  if (options.placeTitle) paintPlaceTitle(ctx, options.width, options.height, options.placeTitle, bottom);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx;
}

/** The caller owns this capture instance. The live editor must never be passed here. */
export async function encodeCapturePNG(capture: SceneEngine, options: PNGOptions) {
  const { width, height, signal } = options;
  if (![width, height].every(n => Number.isInteger(n) && n >= 128 && n <= 8192) || width * height > 16_000_000)
    throw new Error("Unsupported PNG dimensions");
  signal?.throwIfAborted();
  if (options.placeTitle?.text) await ensureTitleFonts(options.placeTitle.text, signal);
  signal?.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  try {
    options.onProgress?.(0.15);
    await new Promise(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    paintCapture(capture, canvas, options);
    options.onProgress?.(0.75);
    await new Promise(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const blob = await encodePNG(canvas, signal);
    options.onProgress?.(1);
    return blob;
  } finally { canvas.width = canvas.height = 0; }
}

export function encodePNG(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Export cancelled", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    const finish = () => signal?.removeEventListener("abort", abort);
    try {
      canvas.toBlob((blob) => {
        finish();
        if (signal?.aborted) abort();
        else if (!blob || blob.type !== "image/png")
          reject(new Error("PNG encoding failed"));
        else resolve(blob);
      }, "image/png");
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

export async function exportPNG(
  live: SceneEngine,
  options: PNGOptions,
): Promise<Blob> {
  const { width, height, signal } = options;
  if (
    ![width, height].every(
      (n) => Number.isInteger(n) && n >= 128 && n <= 8192,
    ) ||
    width * height > 16_000_000
  )
    throw new Error("Unsupported PNG dimensions");
  signal?.throwIfAborted();
  options.onProgress?.(0.05);
  const recipe = live.snapshot();
  const bounds = live.data.geometry.bounds;
  if (options.mode === "study") {
    recipe.seed = 29;
    recipe.density = 80;
    recipe.trafficCount = 880;
    recipe.simulationTime = 0;
    recipe.remainder = 0;
    delete recipe.checkpoint;
    recipe.camera = {
      x: (bounds[0] + bounds[2]) / 2,
      y: (bounds[1] + bounds[3]) / 2,
      zoom:
        Math.min(width - 40, height - 40) /
        Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]),
    };
  }
  const engine = live.fork(recipe);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    if (options.mode === "study") {
      // Yield between fixed-step batches, allowing live playback and cancellation.
      for (let i = 0; i < 40; i++) {
        signal?.throwIfAborted();
        engine.advance(1);
        options.onProgress?.(0.1 + (i + 1) / 40 * 0.5);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    signal?.throwIfAborted();
    // Match the preview's opaque target, including browser text antialiasing.
    const view: FrameView =
      options.mode === "study"
        ? {
            width,
            height,
            dpr: 1,
            quietMode: true,
            labels: false,
            vignette: false,
            locale: options.view.locale,
          }
        : options.view;
    paintCapture(engine, canvas, { ...options, view }, 1, options.mode === "study");
    options.onProgress?.(0.75);
    const blob = await encodePNG(canvas, signal);
    options.onProgress?.(1);
    return blob;
  } finally {
    engine.dispose();
    canvas.width = canvas.height = 0;
  }
}
