# Testing

`npm test` checks geometry, simulation, scene isolation, import errors, locale coverage, export behaviour and the production server boundary (Host/origin, proxy trust, limits, cancellation, file isolation and HTTP ranges). `npm run check:presets` checks the eight datasets. `npm run build` runs TypeScript and landmark-pack checks and creates `dist/`; `npm run check:release` verifies build links, fonts, licenses and private-file exclusions. `npm run check:landmarks` checks reviewed source conflicts, anchors, model heights and pack hashes without network access.

## Browser checks

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

For Android startup regressions, test a production build on a physical device through USB debugging. Reload the editor several times, switch all eight maps and three palettes, and generate a PNG. Check the actual displayed image and browser GPU logs as well as JavaScript errors: a reproduced Adreno failure reported the page ready and its canvas context intact while the entire page was black. Inspect for Skia shader compilation failures and EGL allocation errors. If an old build has already broken rendering, fully restart the browser before comparing the fix. Desktop viewport emulation does not exercise the phone's GPU driver.

## Landmark update verification

The `aerial-7` update passed the eight-map Edge regression, desktop/mobile English and Traditional Chinese PNG comparisons, scene/player restoration, and Edge/WebKit landmark, transparency and capture checks. Production Edge exported PNG, GIF and 15-second MP4/WebM; independent decoding confirmed 450 video frames at 1920×1200. The gallery source exported 900 frames at 1920×1080 over 30 seconds. Physical-phone validation of this renderer is still pending.

A local Windows Edge 153 comparison on 2026-09-14 used isolated pages, the same bundled snapshots, 1280×800 output, a fixed camera, density 80 and 60 render/advance steps. These are single-run diagnostic samples, not device guarantees:

| Scene | Previous atlas construction | New atlas construction | Previous / new average frame work |
| --- | --- | --- | --- |
| Xinyi | 1.62 s | 1.75 s | 4.85 / 5.07 ms |
| Sapporo | 2.51 s | 2.67 s | 8.60 / 9.03 ms |
| Tokyo | 2.87 s | 3.32 s | 10.10 / 9.86 ms |
| Shanghai | 1.75 s | 1.88 s | 5.00 / 4.91 ms |

Face ordering increases one-time work while animation remains atlas compositing. The compared atlas pairs occupied approximately 91–98 MiB of raw RGBA storage in the new renderer, excluding browser overhead and capture copies. The bounded painter fallback is still used for some intersecting structures; inspect detailed fixtures when adding models.

## Orthographic scene verification

The aerial-8 implementation passed 93 Node tests, eight preset checks, TypeScript, both landmark manifests, build and release checks. Edge 153 and WebKit 26.5 verified identical pixels for saved/reopened scenes, compact links and capture copies in Shanghai, Xinyi, Sapporo and Tokyo. The same fixtures matched an independently archived aerial-7 renderer exactly when opened in compatibility mode. The SWFC portal measured alpha 0 and the body alpha 255. Desktop and mobile viewport UI checks in both languages verified file import, links and explicit artwork upgrade without changing the traffic checkpoint or camera. The eight-city Edge regression also checked real PNG downloads and preview equality.

Single-run Windows diagnostics on 2026-09-15 used 1280×800 output, a fixed camera and 60 advance/render steps. These measure CPU-side work in desktop browsers, not physical-phone frame rates:

| Scene | Edge 153 construction / frame work | WebKit 26.5 construction / frame work |
| --- | --- | --- |
| Shanghai | 2.07 s / 8.28 ms | 1.80 s / 23.60 ms |
| Xinyi | 2.94 s / 8.66 ms | 1.53 s / 23.30 ms |
| Sapporo | 4.63 s / 9.60 ms | 2.46 s / 27.37 ms |
| Tokyo | 3.38 s / 6.93 ms | 2.75 s / 33.18 ms |

Baking the fixed projection once reduced the sampled WebKit frame work from 30.5–43.8 ms to 23.3–33.2 ms. Build timings vary with browser and host load. Shanghai's 8102 primitives needed 45098 overlap comparisons with no cycles or budget fallbacks. The persistent atlas pairs used about 90–97 MiB of raw RGBA, before browser overhead, temporary projection conversion and capture copies. Sphere/loft tessellation and facade details are bounded and remain the same across preview, files and exports.

Production Edge exported PNG, GIF and 15-second MP4/WebM with the final projection cache. Independent decoding confirmed 450 frames at 1920×1200 in both video formats and 90 GIF frames over six seconds at 720×450. WebKit passed PNG/GIF export and both-language narrow layouts; its video cases were skipped. The refreshed gallery source contains 900 frames at 1920×1080 over 30 seconds.

This update was accepted for simulated mobile testing; physical Android and iPhone performance have not been verified. The existing Android/Adreno software-atlas workaround remains in place. Generic intersecting volumes can still need the documented painter fallback; six supported landmarks do not imply automatic recognition of every landmark.

## Public artwork

`create-showcase.mjs` downloads five actual PNGs, including Xinyi's Taipei 101, and a 30-second MP4. The public gallery clip is a compressed 12-second excerpt.

To rebuild the covers, serve the production build and make Playwright and FFmpeg available, then run `node scripts/create-social-preview.mjs`. It uses `public/gallery/sapporo.mp4` and `public/favicon.svg` to create a six-second README GIF and a 1280×640 social-preview still. `SOCIAL_VIDEO` selects another Sapporo export; `QA_URL` and `QA_OUTPUT` select the app address and output folder.

Review the results before replacing `docs/images/social-cover.gif` and `docs/images/social-left.jpg`, and update the hashes in `public/gallery/credits.json`. Preserve visible OpenStreetMap credit beside shared media.
