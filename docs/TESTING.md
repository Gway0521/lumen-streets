# Testing

Use Node.js 24 and Python 3.12:

```sh
npm ci
npm run setup:buildings
npm test
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

Start npm run dev on port 5180. The locked @playwright/test dependency is included; scripts use installed Microsoft Edge. QA_URL selects another server. Run GPU suites one at a time.

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

## Public artwork

With the app running and Chromium or Edge and FFmpeg installed:

```sh
node scripts/create-showcase.mjs
node scripts/create-social-preview.mjs
```

BROWSER_CHANNEL=msedge selects Edge. QA_URL and QA_OUTPUT select the server and output directory. The showcase script exports eight PNGs and a 30-second video, then creates a 12-second gallery clip and poster. Review and copy the selected files to public/gallery/ before generating the cover from that clip.

The social script produces a six-second README GIF and 1280×640 still. Copy the still to docs/images/social-left.jpg and public/social-preview.jpg, and the GIF to docs/images/social-cover.gif. Update public/gallery/credits.json with provenance and hashes, rebuild, and run npm run check:release. Source downloads and temporary frames stay in ignored artifacts/.
