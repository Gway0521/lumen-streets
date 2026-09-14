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
  duration = 6,
  signal,
  progress,
}) {
  if (!layer.mesh && map.getZoom() >= 14.1)
    throw Error("Wait for the city to finish loading.");
  const ratio = map.getPixelRatio(),
    snapshot = layer.traffic?.snapshot(),
    time = layer.time,
    accumulator = layer.accumulator,
    playing = layer.playing;
  const canvas = map.getCanvas(),
    cssWidth = canvas.clientWidth,
    cssHeight = canvas.clientHeight;
  const size =
      format === "gif" ? Math.min(longEdge, 720) : Math.min(longEdge, 3840),
    scale = size / Math.max(cssWidth, cssHeight);
  const output = document.createElement("canvas");
  output.width = Math.round(cssWidth * scale);
  output.height = Math.round(cssHeight * scale);
  if (format === "video") {
    output.width -= output.width % 2;
    output.height -= output.height % 2;
  }
  const ctx = output.getContext("2d", { willReadFrequently: format === "gif" });
  let worker;
  stream.locked = true;
  stream.generation++;
  layer.capturing = true;
  layer.playing = false;
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
    const font = Math.max(10, Math.round(output.width / 120));
    ctx.font = `${font}px sans-serif`;
    const credit =
      "Map data © OpenStreetMap contributors · ODbL | OpenFreeMap · OpenMapTiles";
    const lines =
      ctx.measureText(credit).width > output.width - font * 2
        ? [
            "Map data © OpenStreetMap contributors · ODbL",
            "OpenFreeMap · OpenMapTiles",
          ]
        : [credit];
    const height = font * (lines.length * 1.3 + 0.7);
    ctx.fillStyle = "rgba(5,13,19,.7)";
    ctx.fillRect(0, output.height - height, output.width, height);
    ctx.fillStyle = "#9bafb5";
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        font,
        output.height - font * 0.6 - (lines.length - 1 - i) * font * 1.3,
      ),
    );
  };
  try {
    map.setPixelRatio(scale);
    await paintNext(map);
    signal?.throwIfAborted();
    copy();
    if (format === "png") {
      return await new Promise((resolve, reject) =>
        output.toBlob(
          (b) =>
            b
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
        progress((i + 1) / 60);
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
    worker?.terminate();
    if (snapshot) layer.traffic?.restore(snapshot);
    layer.time = time;
    layer.accumulator = accumulator;
    layer.playing = playing;
    layer.capturing = false;
    layer.last = performance.now();
    layer.updatePoints();
    map.setPixelRatio(ratio);
    enabled.forEach((k) => map[k].enable());
    stream.locked = false;
    stream.schedule();
    map.triggerRepaint();
    output.width = output.height = 1;
  }
}
