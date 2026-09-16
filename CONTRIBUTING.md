# Contributing

Bug fixes, translations and maps that expose rendering problems are welcome. For a large feature, open an issue first so the scope is clear.

## Run and check

Use Node.js 24 and Python 3.12 with pip and venv. Run `npm ci` and `npm run dev`, then open http://127.0.0.1:5180/.

Before submitting a change:

```sh
npm test
npm run check:presets
npm run build
npm run check:release
```

For visual changes, compare actual exports in both languages on desktop and a narrow viewport. Check that the editor keeps its view and playback state while exporting. The optional browser suites are described in [Testing](docs/TESTING.md).

## Keep changes focused

Preserve the [art direction](docs/ART_DIRECTION.md) and keep the 3D editor, embeds and exports on one rendering path. The legacy 2D player retains its separate compatibility engine. Fix shared rules instead of special-casing a city. Seed procedural randomness and use the simulation clock.

The 3D interface messages live in `src/three/locales.js`; legacy player messages live in `src/locales/`; update English and Traditional Chinese together, including error and accessibility text. Map names may fall back to their source language.

Add tests for behaviour and regressions. Explain the need, license and bundle cost of a new dependency. Keep build output, personal paths, credentials and machine settings out of commits.

## Reporting a problem

Include the location, browser/OS, viewport or device, steps to reproduce, and what you expected. For exports, include format, size and duration. A screenshot helps; a scene file can help too, but it contains the selected location and settings.

Map corrections generally belong in OpenStreetMap. For contributed snapshots, retain source metadata and licensing; see [Map data and services](docs/PROVIDERS.md). Do not contribute proprietary maps or unbounded datasets.

## Pull requests

Describe the problem and resulting behaviour, then the checks you ran. Add an attributed before/after image for artwork changes. Keep changes small enough to review. Documentation and code comments use English; discussion may use English or Traditional Chinese.

Contributions to the application are accepted under AGPL-3.0-only. Preserve existing copyright notices and the licenses of third-party code and data.
