import { CaptureSession } from "./capture-session.ts";
import { VIEW, sceneZoom } from "./view.js";
import { captureSize, paintComposition, labelFontText } from "./composition.js";
import { ensureTitleFonts } from "../export/title-fonts.ts";
const pendingDownloads = new Set();
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    for (const dispose of pendingDownloads) dispose();
  });
export function download(blob, name, release) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  const dispose = () => {
    URL.revokeObjectURL(url);
    release?.();
    pendingDownloads.delete(dispose);
  };
  pendingDownloads.add(dispose);
  setTimeout(dispose, 60000);
}
const paintNext = (map) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.off("render", done);
      reject(Error("Renderer did not produce a frame."));
    }, 12000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    map.once("render", done);
    map.triggerRepaint();
  });
export async function exportNight({
  map,
  layer,
  stream,
  format,
  longEdge = 1920,
  duration = 30,
  composition = {},
  aspect,
  signal,
  progress,
}) {
  if (!layer.mesh && sceneZoom(map) >= VIEW.atlas)
    throw Error("Wait for the city to finish loading.");
  const ratio = map.getPixelRatio();
  const session = new CaptureSession(layer, stream);
  const canvas = map.getCanvas(),
    cssWidth = canvas.clientWidth,
    cssHeight = canvas.clientHeight;
  const [width, height] = captureSize(
    aspect ?? cssWidth / cssHeight,
    longEdge,
    format,
  );
  const scale = Math.max(width / cssWidth, height / cssHeight);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d", { willReadFrequently: format === "gif" });
  let worker, wakeLock;
  session.begin();
  const handlers = [
    "dragPan",
    "scrollZoom",
    "boxZoom",
    "dragRotate",
    "keyboard",
    "doubleClickZoom",
    "touchZoomRotate",
    "touchPitch",
  ];
  const enabled = handlers.filter((k) => map[k]?.isEnabled());
  enabled.forEach((k) => map[k].disable());
  const copy = () => {
    ctx.drawImage(canvas, 0, 0, output.width, output.height);
    paintComposition(ctx, output.width, output.height, composition, layer);
  };
  try {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {}
    const names = composition.landmarkLabels
      ? labelFontText(layer, composition.locale)
      : "";
    await ensureTitleFonts(
      `${composition.placeTitle?.text || ""} ${names}`,
      signal,
    );
    map.setPixelRatio(scale);
    await paintNext(map);
    signal?.throwIfAborted();
    copy();
    if (format === "png") {
      return await new Promise((resolve, reject) =>
        output.toBlob(
          (b) =>
            signal?.aborted
              ? reject(signal.reason)
              : b
                ? resolve({ blob: b, extension: "png" })
                : reject(Error("PNG encoding failed.")),
          "image/png",
        ),
      );
    }
    if (format === "gif") {
      worker = new Worker(new URL("./gif.worker.js", import.meta.url), {
        type: "module",
      });
      const request = (message, transfer = []) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("GIF encoding timed out.")),
            30000,
          );
          worker.onmessage = ({ data }) => {
            clearTimeout(timer);
            data.error ? reject(Error(data.error)) : resolve(data);
          };
          worker.onerror = (e) => {
            clearTimeout(timer);
            reject(Error(e.message));
          };
          worker.postMessage(message, transfer);
        });
      await request({ type: "start" });
      for (let i = 0; i < 60; i++) {
        signal?.throwIfAborted();
        if (i) layer.advance(0.1);
        await paintNext(map);
        copy();
        const rgba = ctx.getImageData(0, 0, output.width, output.height).data;
        await request(
          {
            type: "frame",
            width: output.width,
            height: output.height,
            rgba: rgba.buffer,
          },
          [rgba.buffer],
        );
        progress?.((i + 1) / 60);
      }
      const { bytes } = await request({ type: "finish" });
      return {
        blob: new Blob([bytes], { type: "image/gif" }),
        extension: "gif",
      };
    }
    const { encodeNightVideo } = await import("./video.js");
    return await encodeNightVideo(output, {
      duration,
      signal,
      progress,
      frame: async (i) => {
        if (i) layer.advance(1 / 30);
        await paintNext(map);
        copy();
      },
    });
  } finally {
    await wakeLock?.release().catch(() => {});
    worker?.terminate();
    session.restore();
    layer.last = performance.now();
    layer.updatePoints();
    map.setPixelRatio(ratio);
    enabled.forEach((k) => map[k].enable());
    stream.schedule();
    map.triggerRepaint();
    output.width = output.height = 1;
  }
}
