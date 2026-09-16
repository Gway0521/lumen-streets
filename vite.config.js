import { defineConfig, loadEnv } from "vite";
import { localMapsPlugin } from "./server/maps.mjs";
import { socialMetadata } from "./scripts/social-metadata.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "LUMEN_");
  return { base: "./", build: { rolldownOptions: { input: { main: "index.html", player: "player.html", three: "three.html" } } }, plugins: [socialMetadata(env.LUMEN_SITE_URL), localMapsPlugin({
    photon: env.LUMEN_PHOTON_URL || undefined,
    overpass: env.LUMEN_OVERPASS_URL || undefined,
  })] };
});
