# Architecture

Lumen Streets now opens the MapLibre/Three.js editor at `index.html`; `three.html` remains an alias entry for existing 3D links. See [3D architecture](3D-ARCHITECTURE.md) ([繁體中文](3D-ARCHITECTURE.zh-TW.md)) for rendering, tile budgets, capture ownership and source limitations.

## Shared foundations

The 3D engine reuses the OSM parser, attributed preset snapshots, traffic simulation, reviewed landmark packs and geometry generators. `src/three/` owns the WebGL layers, streaming worker, composition, model imports and current scene format. Captures and embeds use this renderer.

The Node server in `server/` serves built files and a guarded search/map API. Search remains behind bounded provider adapters. Continuous panning loads compatible vector tiles directly from the configured provider, without issuing Overpass area queries.

## Legacy compatibility

`player.html` and `src/player/` retain read-only playback for existing 2D scene files and links. Their Canvas engine, immutable scene data, versioned recipes and import validation remain in `src/engine/` and `src/scene/`. The old editor source is retained for reference and shared imports, but is not a built editor entry point.

The two scene formats are separate; the 3D editor does not migrate old Canvas recipes. See [Scenes](SCENES.md). The existing gallery and social images remain attributed v0.2.0 artwork until a reviewed 3D artwork refresh.

See [Testing](TESTING.md), [Hosting](HOSTING.md), [map services](PROVIDERS.md) and [building source data](BUILDINGS.md).
