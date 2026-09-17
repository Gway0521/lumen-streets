import { createServer } from "vite";
import { unproject } from "../../src/three/geo.js";

// Synthetic, deterministic footprints. No upstream service is contacted.
export function heightTile(x, y, count = 6) {
  const features = [];
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
    const a = unproject((x + (i + 0.15) / count) / 16384, (y + (j + 0.15) / count) / 16384);
    const b = unproject((x + (i + 0.5) / count) / 16384, (y + (j + 0.5) / count) / 16384);
    const height = 12 + ((i * 13 + j * 7) % 12) * 9;
    features.push({ type: "Feature", id: `fixture/${x}/${y}/${i}/${j}`,
      geometry: { type: "Polygon", coordinates: [[[a[0], a[1]], [b[0], a[1]], b, [a[0], b[1]], a]] },
      properties: { lumen_height_version: 1, height_m: height, min_height_m: 0,
        height_raw: height, floors_raw: null, height_method: "mapped", height_source: "synthetic-fixture",
        height_definition: "ground_to_top", height_missing: false, height_estimated: false, height_match: 1 },
    });
  }
  return { type: "FeatureCollection", features,
    lumen: { revision: "fixture-1", status: "complete", attribution: ["Synthetic test buildings"] } };
}

export async function startFixtureServer(port = 5183) {
  let state = { failures: 0, status: 503, stall: 0, requests: 0, count: 6 };
  const server = await createServer({ configFile: false, base: "/", cacheDir: ".cache/browser-vite",
    server: { host: "127.0.0.1", port, strictPort: true,
      watch: { ignored: ["**/artifacts/**", "**/.local/**", "**/dist/**", "**/.cache/**"] } },
    define: { "import.meta.env.VITE_LUMEN_TILEJSON_URL": JSON.stringify("/fixtures/planet") },
    plugins: [{ name: "browser-fixtures", configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
        if (path === "/fixtures/control") {
          if (req.method === "POST") {
            let body = "";
            for await (const chunk of req) body += chunk;
            state = { failures: 0, status: 503, stall: 0, requests: 0, count: 6, ...JSON.parse(body) };
          }
          return json(state);
        }
        if (path === "/fixtures/planet") return json({ tilejson: "3.0.0", tiles: [`http://127.0.0.1:${port}/fixtures/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14 });
        // Empty basemap MVT is valid; real snapshot roads and real geometry still render.
        if (/^\/fixtures\/\d+\/\d+\/\d+\.pbf$/.test(path)) {
          res.setHeader("Content-Type", "application/x-protobuf"); return res.end(Buffer.alloc(0));
        }
        if (!path?.startsWith("/api/buildings/")) return next();
        state.requests++;
        if (state.stall) {
          if (state.bodyStall) { res.setHeader("Content-Type", "application/json"); res.write("{"); }
          const timer = setTimeout(() => { if (!res.destroyed) { res.statusCode = 503; json({ error: "delayed" }); } }, state.stall);
          res.on("close", () => clearTimeout(timer)); return;
        }
        if (state.failures-- > 0) { res.statusCode = state.status; return json({ error: "fixture failure" }); }
        if (path.endsWith("manifest.json")) return json({ version: 2, global: true, zoom: 14,
          revision: "fixture-1", attribution: ["Synthetic test buildings"], tiles: "./{z}/{x}/{y}.json" });
        const match = /^\/api\/buildings\/14\/(\d+)\/(\d+)\.json$/.exec(path);
        if (match) return json(heightTile(Number(match[1]), Number(match[2]), state.count));
        res.statusCode = 404; json({ error: "unknown fixture" });
      });
    } }],
  });
  await server.listen();
  return server;
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tests/browser/server.mjs")) {
  const server = await startFixtureServer();
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(); });
}
