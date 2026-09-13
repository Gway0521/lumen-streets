import { GIFEncoder, quantize, applyPalette } from "gifenc/dist/gifenc.esm.js";
import { GIF_LIMITS, frameDelay } from "./framing.ts";

/** Sequential, fixed-palette encoding: one RGBA frame in flight, no retained frame array. */
export function createGIFCodec(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 128 && n <= GIF_LIMITS.longEdge))
    throw new Error("Unsupported GIF dimensions");
  const gif = GIFEncoder();
  let palette, frames = 0, finished = false;
  return {
    frame(rgba) {
      if (finished || frames >= GIF_LIMITS.frames || !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4)
        throw new Error("Invalid GIF frame");
      // A single palette prevents still buildings/roads changing colors between frames.
      palette ??= quantize(rgba, 256, { format: "rgb565" });
      const index = applyPalette(rgba, palette, "rgb565");
      gif.writeFrame(index, width, height, { palette: frames === 0 ? palette : undefined, delay: frameDelay(frames), repeat: 0, dispose: 1 });
      frames++;
      if (gif.bytesView().length > GIF_LIMITS.bytes) throw new Error("GIF_TOO_LARGE");
      return frames;
    },
    finish() {
      if (finished || frames !== GIF_LIMITS.frames) throw new Error("Incomplete GIF");
      finished = true; gif.finish();
      if (gif.bytesView().length > GIF_LIMITS.bytes) throw new Error("GIF_TOO_LARGE");
      return gif.bytes();
    },
  };
}
