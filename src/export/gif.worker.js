import { createGIFCodec } from "./gif-codec.js";

let codec;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      if (codec) throw new Error("GIF already initialized");
      codec = createGIFCodec(data.width, data.height);
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame" && codec) {
      self.postMessage({ type: "frame", count: codec.frame(new Uint8Array(data.buffer)) });
    } else if (data.type === "finish" && codec) {
      const bytes = codec.finish();
      self.postMessage({ type: "done", buffer: bytes.buffer }, [bytes.buffer]);
    } else throw new Error("Invalid GIF message");
  } catch (error) {
    self.postMessage({ type: "error", message: error.message === "GIF_TOO_LARGE" ? error.message : "GIF encoding failed" });
    self.close();
  }
};
