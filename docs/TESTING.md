# Testing

`npm test` checks geometry, simulation, scene isolation, import errors, locale coverage, export behaviour and the production server boundary (Host/origin, proxy trust, limits, cancellation, file isolation and HTTP ranges). `npm run check:presets` checks the eight datasets. `npm run build` runs TypeScript and landmark-pack checks and creates `dist/`; `npm run check:release` verifies documentation and build links, artwork hashes, versions, fonts, licenses and private-file exclusions. `npm run check:landmarks` checks reviewed source conflicts, anchors, model heights and pack hashes without network access.

## 3D browser checks

The current editor is 3D. After `npm ci`, start `npm run dev` on port 5180 and set `QA_URL=http://127.0.0.1:5180/` for the suites below (their default is the optional `dev:3d` server on 5183). The locked `@playwright/test` dependency is included; these suites use installed Microsoft Edge.

| Command | Checks |
| --- | --- |
| `npm run check:3d:browser` | Real PNG/GIF/video, rotation, global travel, atlas disposal, languages and mobile viewport |
| `npm run check:3d:capture` | Portrait framing, scene restore, cancellation and landmark contribution ZIP |
| `node scripts/check-3d-landscape.mjs` | Vegetation masks and nearby/long-distance search navigation |
| `node scripts/check-3d-facades.mjs` | Actual GPU facade hashes, detail and instanced geometry |
| `node scripts/check-3d-import.mjs` | Local GLB import/removal, malformed input and export cancellation |
| `node scripts/check-3d-architecture.mjs` | Multi-city architecture and mobile views, including production builds |

Run GPU suites one at a time. Keep evidence beneath ignored `artifacts/`, inspect screenshots and independently decode output files. Physical-device tests remain separate from viewport emulation.

## Legacy Canvas browser checks

The historical suites below target the v0.2.0 editor and its debug hooks. They do not run against the new 3D homepage. Use an isolated historical checkout for those editor checks; the legacy player and shared geometry still receive unit coverage in the current checkout.

The scripts use Playwright separately from the app's dependencies. After `npm ci`, install the browser test tools without changing the package manifest or lockfile:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium` if browser system libraries are missing. Start `npm run dev` in one terminal, then run this in another:

```sh
node scripts/check-browser.mjs
```

Alternatively, set `PLAYWRIGHT_MODULE` to the absolute `index.mjs` path of an existing Playwright installation. `BROWSER_CHANNEL=msedge` selects installed Edge where supported. Set `QA_URL` for the running app and `QA_OUTPUT` for output; defaults use port 5180 and ignored `artifacts/` folders. Running `npm ci` again removes the separately installed test package.

| Script | Checks |
| --- | --- |
| `check-browser.mjs` | Eight scenes, PNG output, locales, input and recovery |
| `check-export-browser.mjs` | PNG/GIF downloads, cancellation, worker disposal and state isolation |
| `check-video-browser.mjs` | MP4/WebM downloads, codec failures and cancellation |
| `check-scenes-browser.mjs` | Complete files, links, player, exact restoration and visibility |
| `check-search-browser.mjs` | Mocked providers, import errors and custom-area PNG |
| `check-beta-browser.mjs` | Idle/background behaviour, resize, recovery and performance samples |
| `check-interaction-browser.mjs` | Coalesced gestures and paused-state preservation |
| `check-art-browser.mjs` | Captions, icon space, actual PNG/GIF/15-second video and layouts |
| `check-landmarks-browser.mjs` | Eight-map labels, source-based lighting, small roads and mobile layouts |
| `check-depth-browser.mjs` | Deterministic structures, roof occlusion, courtyard transparency, brightness fallback, capture copies and portrait renders; supports `QA_BROWSER=webkit` |
| `check-landmark-browser.mjs` | Taipei 101/Sapporo TV Tower close and wide renders, lattice alpha, exact saved-file/fork pixels, embedded reference profiles, primitive counts and timings; supports `QA_BROWSER=webkit` |
| `check-projection-browser.mjs` | Orthographic sky-portal alpha, four-city saved-file/link/capture equality, optional independent aerial-7 baseline comparison and timings; Edge/WebKit |
| `check-projection-ui.mjs` | Actual Shanghai file/link UI, legacy-file opening and explicit upgrade preserving traffic/camera; both languages and desktop/mobile; Edge/WebKit |
| `check-upgrade-browser.mjs` | Appearance migration, long 1440p exports and storage failures |
| `check-screen-ratio-browser.mjs` | Full-display export ratios independent of viewport size, rotation, both languages and actual PNGs; supports production builds and `BROWSER_TYPE=webkit` |

Most instrumented checks need the dev server. `check-art-browser.mjs` supports `QA_PRODUCTION=1`; its synthetic painter checks are skipped for compiled builds. Art and landmark scripts accept `QA_BROWSER=webkit`; the art script skips video cases there. The beta script uses `BROWSER_TYPE=chromium|firefox|webkit` instead. Consult each script before selecting a browser.

Some suites default to installed Edge; check the script's browser option before running it. Install additional Playwright engines with `npx playwright install webkit firefox` when needed.

Long-video checks use fresh persistent profiles beneath the output directory. Allow several minutes and several GB of disk space. Record physical-device testing separately from viewport tests.

Inspect actual output and independently decode animations. Verify dimensions, duration, frame count and an end frame with FFprobe/FFmpeg; GIF frames can be read with Pillow.

## Device and performance checks

Test production builds on physical phones separately from desktop viewport tests. Reload the editor, visit the preset cities and a global location, rotate and zoom, try both languages, and export a PNG. Inspect the displayed image and browser errors. Android GPU regressions also need device GPU logs; a completed page load alone does not prove that the display rendered correctly.

For performance comparisons, use the same browser, map snapshot, camera, seed, traffic density and output size. Measure atlas construction separately from animation frame work. Run one browser suite at a time. Record browser/device versions and distinguish diagnostic samples from repeated benchmarks.

The projection suite checks saved-file, link and capture pixel equality, open landmark geometry and optional comparison with an archived renderer. Review landscape and portrait output for each affected city. Current support and remaining device gaps are listed in [Compatibility](COMPATIBILITY.md).

## Public artwork

The existing gallery, README cover and social preview are archived v0.2.0 artwork. The showcase workflow below targets that historical Canvas editor; do not run it against the 3D homepage. A reviewed 3D artwork refresh is separate release work.

`create-showcase.mjs` downloads five actual PNGs, including Xinyi's Taipei 101, and a 30-second MP4. The public gallery clip is a compressed 12-second excerpt.

To rebuild the covers, serve the production build and make Playwright and FFmpeg available, then run `node scripts/create-social-preview.mjs`. It uses `public/gallery/sapporo.mp4` and `public/favicon.svg` to create a six-second README GIF and a 1280×640 social-preview still. `SOCIAL_VIDEO` selects another Sapporo export; `QA_URL` and `QA_OUTPUT` select the app address and output folder.

Review the results before replacing `docs/images/social-cover.gif` and `docs/images/social-left.jpg`, and update the hashes in `public/gallery/credits.json`. Copy the approved still to `public/social-preview.jpg` too. Temporary cover frames are removed after the run. Preserve visible OpenStreetMap credit beside shared media.
