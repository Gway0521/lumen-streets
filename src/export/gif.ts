import { ensureTitleFonts } from "./title-fonts.ts";
import type { SceneEngine } from "../engine/scene-engine.ts";
import { paintCapture, encodePNG, type PNGOptions } from "./png.ts";
import { GIF_LIMITS } from "./framing.ts";

export type GIFOptions = Omit<PNGOptions, "mode">;

/** Worker ownership includes initialization, failure, cancellation and completion. */
export class GIFWorker {
  private worker: Worker;
  private pending?: { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private stopped = false;
  constructor(factory = () => new Worker(new URL("./gif.worker.js", import.meta.url), { type: "module" })) {
    this.worker = factory();
    this.worker.onmessage = ({ data }) => {
      if (data.type === "error") this.fail(new Error(data.message));
      else if (this.pending) {
        clearTimeout(this.pending.timer); const pending = this.pending; this.pending = undefined; pending.resolve(data);
      }
    };
    this.worker.onerror = event => { event.preventDefault(); this.fail(new Error("GIF worker failed")); };
    this.worker.onmessageerror = () => this.fail(new Error("GIF worker response failed"));
  }
  private fail(error: Error) {
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    this.dispose();
  }
  send(data: unknown, transfer: Transferable[] = []): Promise<any> {
    if (this.stopped || this.pending) return Promise.reject(new Error("GIF worker unavailable"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.fail(new Error("GIF encoding timed out")), 15000) };
      try { this.worker.postMessage(data, transfer); } catch { this.fail(new Error("GIF worker unavailable")); }
    });
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true; this.worker.terminate();
    if (this.pending) {
      clearTimeout(this.pending.timer); this.pending.reject(new DOMException("Export cancelled", "AbortError")); this.pending = undefined;
    }
  }
}

/** Mutates only the caller-owned capture. The caller disposes its scene instance. */
export async function encodeCaptureGIF(capture: SceneEngine, options: GIFOptions, workerFactory?: () => Worker) {
  const { width, height, signal } = options;
  if (![width, height].every(n => Number.isInteger(n) && n >= 128 && n <= GIF_LIMITS.longEdge))
    throw new Error("Unsupported GIF dimensions");
  signal?.throwIfAborted();
  if (options.placeTitle?.text) await ensureTitleFonts(options.placeTitle.text, signal);
  signal?.throwIfAborted();
  const worker = new GIFWorker(workerFactory);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const abort = () => worker.dispose(); signal?.addEventListener("abort", abort, { once: true });
  try {
    await worker.send({ type: "init", width, height });
    signal?.throwIfAborted();
    let poster: Blob | undefined;
    for (let frame = 0; frame < GIF_LIMITS.frames; frame++) {
      signal?.throwIfAborted();
      if (frame) capture.advance(1 / GIF_LIMITS.fps);
      const ctx = paintCapture(capture, canvas, options);
      if (frame === 0) poster = await encodePNG(canvas, signal);
      signal?.throwIfAborted();
      const rgba = ctx.getImageData(0, 0, width, height).data;
      await worker.send({ type: "frame", buffer: rgba.buffer }, [rgba.buffer]);
      options.onProgress?.((frame + 1) / (GIF_LIMITS.frames + 1));
      // Give the live host a turn even if the worker acknowledges immediately.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const response = await worker.send({ type: "finish" });
    signal?.throwIfAborted();
    if (!(response.buffer instanceof ArrayBuffer) || response.buffer.byteLength > GIF_LIMITS.bytes)
      throw new Error("Invalid GIF output");
    options.onProgress?.(1);
    return { blob: new Blob([response.buffer], { type: "image/gif" }), poster: poster! };
  } finally {
    signal?.removeEventListener("abort", abort); worker.dispose(); canvas.width = canvas.height = 0;
  }
}
