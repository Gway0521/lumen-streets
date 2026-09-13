# Architecture

Lumen Streets is a Vite app with Canvas 2D rendering. Static streets and buildings are drawn once into an atlas; cars and trains are painted over it as the simulation advances. The editor, exported files and read-only player use the same engine.

## Source map

| Area | Responsibility |
| --- | --- |
| `src/main.js` | Editor controls, URL, viewport and frame scheduling |
| `src/city.js`, `aerial.js` | OSM projection, polygon rings and static artwork |
| `src/lighting.js`, `street-colors.js`, `landmarks.js` | District contrast, street colours and source-derived names |
| `src/traffic.js`, `rail.js` | Road graph, seeded cars, signals and train routes |
| `src/scene/` | Immutable source data, validated recipes, portable files and sharing UI |
| `src/engine/` | Camera, simulation, atlas ownership and frame composition |
| `src/export/` | Crop, captions, PNG/GIF/video encoders and temporary storage |
| `src/player/` | Read-only scene host and visibility-aware playback |
| `src/search/`, `server/` | Place selection, bounded imports and shared provider adapters |
| `src/locales/` | English and Traditional Chinese interface text |
| `public/data/` | Attributed OpenStreetMap snapshots |

## Scene ownership

`SceneData` contains frozen geometry, source metadata and a content fingerprint. `SceneRecipe` contains the camera, palette, appearance, density, seed and simulation checkpoint. Each engine owns its atlas, graph, clock and vehicle state. A two-entry data cache reuses immutable geometry without sharing playback state.

Capturing an image or animation creates an independent engine from the current recipe. Moving an export crop, advancing its traffic or cancelling an encoder cannot advance the editor. Canvas resources, object URLs, workers and temporary files have explicit owners and release paths.

The portable file format and supported renderer versions are documented in [Scenes](SCENES.md). Engine contracts are internal interfaces.

## Drawing and motion

The aerial atlas uses world coordinates for continuous warm street colours and sparse cool landmark accents. Source features determine district activity. Named landmarks are cached with immutable geometry; screen-space text measurements avoid label collisions.

Static map and lighting canvases request software rasterization with `willReadFrequently`. This keeps detailed atlas construction off the GPU command queue, avoiding a reproduced Android/Adreno failure that left the browser unable to draw even ordinary pages. Atlas dimensions and lighting rules stay the same; the display canvas keeps its normal rendering path. Initial construction can take longer, and rasterization differences can slightly change edge smoothing.

Vehicle births are weighted by road length and road class. At junctions, drivers favour continuation and through roads, with less weight for crowded outgoing segments. Cars returning from a side street can accelerate again. Spawn positions respect existing vehicle gaps. Signals, following gaps and deadlock respawns provide visual traffic behaviour rather than a complete transport model.

Simulation advances in fixed 50 ms steps with checkpointed randomness. Idle, paused and background views stop requesting frames. Gestures are coalesced into one paint per display frame; resizes preserve the world centre. Brightness uses Canvas filters when available and atlas compositing otherwise.

## Exports and imports

PNG uses the shared capture painter. GIF sends one transferable frame at a time to a worker and uses a fixed palette. MP4/WebM use WebCodecs through Mediabunny, with fixed timestamps and compressed output streamed to browser temporary storage. See [Exports](EXPORTS.md) for dimensions and limits.

The production Node server serves built files and the map API at one origin behind an HTTPS proxy or tunnel. A separate request guard handles public-origin checks, visitor limits and an explicitly selected client-IP header from a trusted loopback proxy. Provider budgets and cache state persist outside the release directory.

Map retrieval stays outside drawing code. Search requires an explicitly submitted query; source responses are bounded and validated before becoming scene data. Static hosting has no map gateway. See [Providers](PROVIDERS.md) for deployment and cache ownership.
