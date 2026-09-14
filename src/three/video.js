import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  Quality,
  canEncodeVideo,
} from "mediabunny";
import { videoStorage, videoStorageAvailable } from "../export/storage.ts";

/** Fixed timestamps decouple the wallpaper's duration from rendering speed. */
export async function encodeNightVideo(
  canvas,
  { duration, signal, frame, progress },
) {
  if (![6, 15, 30].includes(duration))
    throw Error("Unsupported video duration.");
  const bitrate = Math.min(
    24000000,
    Math.round((12000000 * canvas.width * canvas.height) / (1920 * 1080)),
  );
  let codec;
  for (const candidate of ["avc", "vp9"])
    if (
      await canEncodeVideo(candidate, {
        width: canvas.width,
        height: canvas.height,
        bitrate,
      })
    ) {
      codec = candidate;
      break;
    }
  if (!codec) throw Error("Video encoding is unavailable at this resolution.");
  signal?.throwIfAborted();
  const large = Math.max(canvas.width, canvas.height) > 1920;
  if (!(await videoStorageAvailable(large, (bitrate * duration) / 8)))
    throw Error("Not enough temporary storage for this video.");
  const storage = await videoStorage(large),
    extension = codec === "avc" ? "mp4" : "webm";
  let output,
    complete = false,
    cancellation,
    failure,
    timer,
    encoded = 0;
  const cancel = () => {
    cancellation ??= output?.cancel().catch(() => {});
  };
  const deadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      failure = Error("Video encoding timed out.");
      cancel();
    }, 30000);
  };
  try {
    output = new Output({
      format:
        codec === "avc"
          ? new Mp4OutputFormat({ fastStart: false })
          : new WebMOutputFormat(),
      target: storage.target,
    });
    const source = new CanvasSource(canvas, {
      codec,
      quality: new Quality({ bitrate }),
      keyFrameInterval: 2,
      onEncodedPacket(packet) {
        encoded += packet.byteLength;
        if (encoded > 128 * 1024 * 1024) {
          failure = Error("Video exceeded its output budget.");
          cancel();
        }
      },
    });
    output.addVideoTrack(source, { frameRate: 30 });
    output.setMetadataTags({
      title: "Lumen Streets 3D",
      comment:
        "Map data © OpenStreetMap contributors · ODbL | https://www.openstreetmap.org/copyright",
    });
    signal?.addEventListener("abort", cancel, { once: true });
    signal?.throwIfAborted();
    deadline();
    await output.start();
    for (let i = 0; i < duration * 30; i++) {
      signal?.throwIfAborted();
      if (failure) throw failure;
      await frame(i);
      await source.add(i / 30, 1 / 30);
      deadline();
      progress?.((i + 1) / (duration * 30 + 1));
    }
    source.close();
    await output.finalize();
    signal?.throwIfAborted();
    if (failure) throw failure;
    const blob = await storage.file(`video/${extension}`);
    complete = true;
    progress?.(1);
    return { blob, extension, release: storage.release };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    if (!complete) {
      cancel();
      await cancellation;
      await storage.release();
    }
  }
}
