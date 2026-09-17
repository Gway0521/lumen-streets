import { defineConfig, loadEnv } from "vite";
import { localMapsPlugin } from "./server/maps.mjs";
import { globalBuildingsPlugin } from "./server/buildings/index.mjs";
import { socialMetadata } from "./scripts/social-metadata.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "LUMEN_");
  return { base: "./", build: { rolldownOptions: { input: { main: "index.html", player: "player.html", three: "three.html" } } }, plugins: [globalBuildingsPlugin({
    directory: env.LUMEN_BUILDINGS_CACHE_DIR || undefined,
    python: env.LUMEN_BUILDINGS_PYTHON || undefined,
    metricsInterval: Number(env.LUMEN_BUILDINGS_METRICS_INTERVAL_MS || 0),
  }), socialMetadata(env.LUMEN_SITE_URL), localMapsPlugin({
    photon: env.LUMEN_PHOTON_URL || undefined,
    overpass: env.LUMEN_OVERPASS_URL || undefined,
  })] };
});
