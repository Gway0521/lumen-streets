import { ensureTitleFonts } from "./title-fonts.ts";
import { Output, Mp4OutputFormat, WebMOutputFormat, CanvasSource, Quality, canEncodeVideo } from "mediabunny";
import type { SceneEngine } from "../engine/scene-engine.ts";
import { paintCapture, encodePNG, type PNGOptions } from "./png.ts";
import { VIDEO_LIMITS, videoSeconds } from "./framing.ts";
import { videoStorage, videoStorageAvailable } from './storage.ts';
export { hasVideoStorage, videoStorageAvailable } from './storage.ts';

export type VideoOptions = Omit<PNGOptions, "mode"> & { format: "mp4" | "webm"; seconds: number };
export const videoBitrate = (width: number, height: number) => Math.round(16_000_000 * width * height / (1920 * 1080));
const codec = (format: "mp4" | "webm") => format === "mp4" ? "avc" : "vp9";
export async function supportsVideo(format: "mp4" | "webm", width: number, height: number) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return false;
  try { return await canEncodeVideo(codec(format), { width, height, bitrate: videoBitrate(width, height) }); } catch { return false; }
}

/** Offline frame timestamps give the exact duration even when encoding is slower than playback. */
export async function encodeCaptureVideo(capture: SceneEngine, options: VideoOptions) {
  const { width, height, seconds, signal, format } = options;
  videoSeconds(seconds);
  if (!["mp4", "webm"].includes(format) ||
      ![width, height].every(n => Number.isInteger(n) && n >= 128 && n <= VIDEO_LIMITS.longEdge && n % 2 === 0))
    throw new Error("Invalid video options");
  signal?.throwIfAborted();
  if (!await supportsVideo(format, width, height)) throw new Error("VIDEO_UNSUPPORTED");
  signal?.throwIfAborted();
  const large = seconds > 60 || Math.max(width,height) > 1920;
  if (!await videoStorageAvailable(large, videoBitrate(width,height) * seconds / 8)) throw new Error('VIDEO_STORAGE_UNAVAILABLE');
  signal?.throwIfAborted();
  if (options.placeTitle?.text) await ensureTitleFonts(options.placeTitle.text, signal);
  signal?.throwIfAborted();
  const storage = await videoStorage(large);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  let output: Output | undefined;
  let encodedBytes = 0, completed = false, failure: Error | undefined, cancellation: Promise<void> | undefined;
  const cancel = () => { cancellation ??= output?.cancel().catch(() => {}); };
  const stop = (error: Error) => { failure = error; cancel(); };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = () => { clearTimeout(timer); timer = setTimeout(() => stop(new Error("VIDEO_TIMEOUT")), 30_000); };
  try {
    signal?.throwIfAborted();
    output = new Output({ format: format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target: storage.target });
    const source = new CanvasSource(canvas, { codec: codec(format), quality: new Quality({ bitrate: videoBitrate(width, height) }), keyFrameInterval: 2,
      onEncodedPacket(packet) { encodedBytes += packet.byteLength; if (encodedBytes > storage.limit) stop(new Error("VIDEO_TOO_LARGE")); } });
    output.addVideoTrack(source, { frameRate: VIDEO_LIMITS.fps });
    output.setMetadataTags({ title: options.title, comment: `${capture.data.source.attribution}\nhttps://www.openstreetmap.org/copyright` });
    signal?.addEventListener("abort", cancel, { once: true });
    // Also stop a stalled native encoder; each successful frame refreshes its deadline.
    deadline(); await output.start();
    let poster: Blob | undefined;
    const frames = seconds * VIDEO_LIMITS.fps;
    for (let frame = 0; frame < frames; frame++) {
      signal?.throwIfAborted(); if (failure) throw failure;
      if (frame) capture.advance(1 / VIDEO_LIMITS.fps);
      paintCapture(capture, canvas, options);
      if (!frame) poster = await encodePNG(canvas, signal);
      await source.add(frame / VIDEO_LIMITS.fps, 1 / VIDEO_LIMITS.fps);
      deadline(); options.onProgress?.((frame + 1) / (frames + 1));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    source.close(); await output.finalize();
    signal?.throwIfAborted(); if (failure) throw failure;
    const blob = await storage.file(`video/${format}`);
    if (blob.size > storage.limit) throw new Error("VIDEO_TOO_LARGE");
    completed = true; options.onProgress?.(1);
    return { blob, poster: poster!, release: storage.release };
  } catch (error) { signal?.throwIfAborted(); throw failure ?? (error instanceof DOMException && error.name === "QuotaExceededError" ? new Error("VIDEO_STORAGE_UNAVAILABLE") : error); }
  finally {
    clearTimeout(timer!); signal?.removeEventListener("abort", cancel);
    if (!completed) { cancel(); await cancellation; await storage.release(); }
    canvas.width = canvas.height = 0;
  }
}
