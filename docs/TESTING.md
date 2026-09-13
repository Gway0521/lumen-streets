# Testing

`npm test` checks geometry, simulation, scene isolation, import errors, locale coverage, export behaviour and the production server boundary (Host/origin, proxy trust, limits, cancellation, file isolation and HTTP ranges). `npm run check:presets` checks the eight datasets. `npm run build` runs TypeScript checks and creates `dist/`; `npm run check:release` verifies build links, fonts, licenses and private-file exclusions.

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
| `check-upgrade-browser.mjs` | Appearance migration, long 1440p exports and storage failures |
| `check-screen-ratio-browser.mjs` | Full-display export ratios independent of viewport size, rotation, both languages and actual PNGs; supports production builds and `BROWSER_TYPE=webkit` |

Most instrumented checks need the dev server. `check-art-browser.mjs` supports `QA_PRODUCTION=1`; its synthetic painter checks are skipped for compiled builds. Art and landmark scripts accept `QA_BROWSER=webkit`; the art script skips video cases there. The beta script uses `BROWSER_TYPE=chromium|firefox|webkit` instead. Consult each script before selecting a browser.

Some suites default to installed Edge; check the script's browser option before running it. Install additional Playwright engines with `npx playwright install webkit firefox` when needed.

Long-video checks use fresh persistent profiles beneath the output directory. Allow several minutes and several GB of disk space. Record physical-device testing separately from viewport tests.

Inspect actual output and independently decode animations. Verify dimensions, duration, frame count and an end frame with FFprobe/FFmpeg; GIF frames can be read with Pillow.

For Android startup regressions, test a production build on a physical device through USB debugging. Reload the editor several times, switch all eight maps and three palettes, and generate a PNG. Check the actual displayed image and browser GPU logs as well as JavaScript errors: a reproduced Adreno failure reported the page ready and its canvas context intact while the entire page was black. Inspect for Skia shader compilation failures and EGL allocation errors. If an old build has already broken rendering, fully restart the browser before comparing the fix. Desktop viewport emulation does not exercise the phone's GPU driver.

## Public artwork

`create-showcase.mjs` downloads four actual PNGs and a 30-second MP4. The public gallery clip is a compressed 12-second excerpt.

To rebuild the covers, serve the production build and make Playwright and FFmpeg available, then run `node scripts/create-social-preview.mjs`. It uses `public/gallery/sapporo.mp4` and `public/favicon.svg` to create a six-second README GIF and a 1280×640 social-preview still. `SOCIAL_VIDEO` selects another Sapporo export; `QA_URL` and `QA_OUTPUT` select the app address and output folder.

Review the results before replacing `docs/images/social-cover.gif` and `docs/images/social-left.jpg`, and update the hashes in `public/gallery/credits.json`. Preserve visible OpenStreetMap credit beside shared media.
