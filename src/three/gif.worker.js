import { GIFEncoder, quantize, applyPalette } from "gifenc/dist/gifenc.esm.js";
let encoder, palette;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") {
      encoder = GIFEncoder();
      palette = null;
      self.postMessage({ ok: true });
    } else if (data.type === "frame") {
      const rgba = new Uint8Array(data.rgba);
      palette ??= quantize(rgba, 256);
      encoder.writeFrame(applyPalette(rgba, palette), data.width, data.height, {
        palette,
        delay: 100,
      });
      self.postMessage({ ok: true });
    } else {
      encoder.finish();
      const bytes = encoder.bytes();
      self.postMessage({ bytes }, [bytes.buffer]);
      encoder = null;
      palette = null;
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
