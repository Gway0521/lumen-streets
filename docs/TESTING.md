# Testing

Use Node.js 24 and Python 3.12:

```sh
npm ci
npm run setup:buildings
npm test
npm run check:dependencies
npm run check:presets
npm run build
npm run check:release
```

Run Python tests with the prepared environment's interpreter (.cache/building-venv/bin/python on Unix, .cache/building-venv/Scripts/python.exe on Windows):

```sh
python -m unittest discover -s scripts/buildings -p test_buildings.py
```

Node tests cover geometry, simulation, scene validation, capture restoration, imports, height provenance, bounded caches/queues and server request isolation. Python tests cover normalization, footprint matching and raster context. Release checks validate documentation links, artwork hashes, versions, fonts, notices and private-file exclusions.

## Browser checks

Every PR runs the core suite with Chromium, in desktop English and a narrow Traditional Chinese viewport:

```sh
npx playwright install chromium
npm run test:browser
```

The suite starts an isolated server on port 5183. Synthetic building tiles and bundled road snapshots keep it independent of upstream services; unexpected external requests fail the test. Rendering, workers, PNG encoding and scene restoration run normally. It also checks export cancellation, transient building failures and the visible Retry control after automatic retries stop. Failed runs retain screenshots and traces in artifacts/browser-results/. BROWSER_CHANNEL=msedge selects an installed Edge for local runs. Browser installation needs network access; the tests do not.

For live provider checks, start npm run dev on port 5180. The scripts below use installed Microsoft Edge. QA_URL selects another development server. Run GPU suites one at a time.

| Command | Coverage |
| --- | --- |
| npm run check:3d:browser | PNG/GIF/video, global travel, atlas disposal, languages and mobile viewport |
| npm run check:3d:capture | Portrait framing, restoration, cancellation and contribution ZIP |
| node scripts/check-3d-heights.mjs | Global data, attribution and desktop/mobile capture |
| node scripts/check-3d-showcase.mjs | Eight views, landmark names, links and scenes |
| node scripts/check-3d-import.mjs | GLB validation, removal and cancellation |
| node scripts/check-3d-landscape.mjs | Vegetation masks and search navigation |
| node scripts/check-3d-facades.mjs | GPU facade seeds and instanced geometry |
| node scripts/check-3d-architecture.mjs | Facade samples and multiple city views |

Evidence belongs in ignored artifacts/. Inspect screenshots and independently decode exports with FFprobe/FFmpeg. Check dimensions, duration, frame count and an end frame. Also smoke-test the packaged site through its visible controls.

Physical devices need separate loading, panning, rotation, language and PNG checks. Sustained travel and long videos need dedicated runs. Keep browser, camera, scene and output dimensions consistent in performance comparisons.

## Types and dependencies

npm run check:types checks the existing TypeScript engine and the 3D worker, height-tile, scene and capture boundaries. The selected JavaScript modules use JSDoc checking; unannotated parameters remain incremental work. Negative contract examples in tests/types/ must continue to produce their expected errors. Runtime validators still check imported scenes and provider data.

npm run check:dependencies rejects static and literal dynamic import cycles across src/. Shared geometry, seeded randomness, road widths and snapshot parsing live in src/shared/; the legacy city module retains its public exports.

## Performance

```sh
npm run bench:service
npm run bench:browser
```

Both commands write JSON under artifacts/performance/ and avoid external providers by default. The browser benchmark uses three fixture densities, actual snapshot roads and reviewed landmarks. It records a fresh browser-context load, a warm worker rebuild, foreground animation-frame interval p50/p95, tile-cache hits/misses, request attempts, geometry resources and heap samples during repeated camera rotation. BENCH_SECONDS sets the sampling duration per scene (default 60; use 900 for sustained runs). Heap samples cover the page where supported, not worker, GPU or total browser memory. Frame intervals measure visible scheduling cadence, not isolated GPU render time. CI software rendering is not a device-performance target.

BENCH_SCENE=shanghai, xinyi or sapporo selects one scene. The report compares retained page heap and ArrayBuffer backing storage after explicit garbage collection before and after the travel loop; the loop itself runs with normal collection. BENCH_URL can point the browser benchmark at an existing development server to measure live scenes. A fresh browser context does not clear server or provider caches. Keep the scene, device, browser, viewport and cache conditions with each result. The service benchmark measures controlled cache/queue/normalization/compression work; it does not predict upstream or Python enrichment capacity or a supported visitor count.

For a running building service, set LUMEN_BUILDINGS_METRICS_INTERVAL_MS=60000 to log cache counters, active/queued work, coalesced requests and process RSS once a minute. Metrics stay in server logs. Cache hit rate is hits / (hits + misses); use counter differences over the observation window. Test distinct cold areas separately from shared cached views, on infrastructure you control.

Physical Android and iPhone runs should record loading, panning, rotation, PNG/cancellation and sustained memory/thermal behaviour. Viewport emulation is a layout check and does not replace these runs.

## Public artwork

With the app running and Chromium or Edge and FFmpeg installed:

```sh
node scripts/create-showcase.mjs
node scripts/create-social-preview.mjs
```

BROWSER_CHANNEL=msedge selects Edge. QA_URL and QA_OUTPUT select the server and output directory. The showcase script exports eight PNGs and a 30-second video, then creates a 12-second gallery clip and poster. Review and copy the selected files to public/gallery/ before generating the cover from that clip.

The social script produces a six-second README GIF and 1280×640 still. Copy the still to docs/images/social-left.jpg and public/social-preview.jpg, and the GIF to docs/images/social-cover.gif. Update public/gallery/credits.json with provenance and hashes, rebuild, and run npm run check:release. Source downloads and temporary frames stay in ignored artifacts/.
