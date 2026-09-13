import { defineConfig, loadEnv } from "vite";
import { localMapsPlugin } from "./server/maps.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "LUMEN_");
  return { base: "./", build: { rolldownOptions: { input: { main: "index.html", player: "player.html" } } }, plugins: [localMapsPlugin({
    photon: env.LUMEN_PHOTON_URL || undefined,
    overpass: env.LUMEN_OVERPASS_URL || undefined,
  })] };
});
