# Architecture

This document describes the classic 2D renderer. The experimental edition has a separate [3D architecture](3D-ARCHITECTURE.md) and [繁體中文版](3D-ARCHITECTURE.zh-TW.md).

Lumen Streets is a Vite app with Canvas 2D rendering. Static streets and buildings are cached in atlases; cars and trains move between the ground and structure layers as the simulation advances. The editor, exported files and read-only player use the same engine.

## Source map

| Area | Responsibility |
| --- | --- |
| `src/main.js` | Editor controls, URL, viewport and frame scheduling |
| `src/city.js`, `aerial.js` | OSM projection, polygon rings and static artwork |
| `src/building-depth.js`, `terrain.js` | Scenic extrusion, facade/roof artwork, vegetation and shoreline reflections |
| `src/buildings/`, `data/landmarks/` | Height resolution, assembly identity, original landmark generators, projected face order and reviewed provenance |
| `src/lighting.js`, `street-colors.js`, `landmarks.js` | District contrast, street colours and source-derived names |
| `src/traffic.js`, `rail.js` | Road graph, seeded cars, signals and train routes |
| `src/scene/` | Immutable source data, validated recipes, portable files and sharing UI |
| `src/engine/` | Camera, simulation, atlas ownership and frame composition |
| `src/engine/projection.js`, `src/buildings/plan.js`, `components.js` | Shared orthographic forward/inverse transforms, whole-building replacement plans and bounded physical geometry |
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

Aerial Gold owns a ground atlas and a transparent structure atlas with independent projected bounds. Versioned assembly plans retain outline identity and explicitly replace selected source components. Source heights and a small landmark pack produce roofs, facades, open rods and physical triangles. A bounded spatial index orders them once by elevation at projected overlaps; curved geometry uses smaller cells to avoid local saturation. The fixed orthographic transform is baked into the ground and structure atlases once; the frame painter applies the same matrix to moving traffic and trains. This avoids repeated affine sampling of large software surfaces. Labels and interaction use shared forward/inverse functions. Open portals and frames retain alpha. Captures copy both surfaces and bounds; new-version copies use the same software context path to preserve transformed sampling. Amber and Blue hour use a ground atlas. See [Buildings](BUILDINGS.md).

The additional structure layer costs up to approximately 49.5 MiB at 3600×3600, before browser overhead. A capture owns another copy. Temporary road-light surfaces are released before structures are allocated. Projection conversion briefly owns a destination surface, then releases the original; it adds no persistent atlas. Geometry, trees, windows, roof equipment and water reflections are prepared once, not per frame; changing glow or district strength rebuilds the aerial artwork.

Static map and lighting canvases request software rasterization with `willReadFrequently` for Android/Adreno compatibility. The display canvas uses its normal rendering path. Software rasterization can increase initial construction time and change edge smoothing.

Vehicle births are weighted by road length and road class. At junctions, drivers favour continuation and through roads, with less weight for crowded outgoing segments. Cars returning from a side street can accelerate again. Spawn positions respect existing vehicle gaps. Signals, following gaps and deadlock respawns provide visual traffic behaviour rather than a complete transport model.

Simulation advances in fixed 50 ms steps with checkpointed randomness. Idle, paused and background views stop requesting frames. Gestures are coalesced into one paint per display frame; resizes preserve the world centre. Brightness uses Canvas filters when available and atlas compositing otherwise.

## Exports and imports

PNG uses the shared capture painter. GIF sends one transferable frame at a time to a worker and uses a fixed palette. MP4/WebM use WebCodecs through Mediabunny, with fixed timestamps and compressed output streamed to browser temporary storage. See [Exports](EXPORTS.md) for dimensions and limits.

The production Node server serves built files and the map API at one origin behind an HTTPS proxy or tunnel. A separate request guard handles public-origin checks, visitor limits and an explicitly selected client-IP header from a trusted loopback proxy. Provider budgets and cache state persist outside the release directory.

Map retrieval stays outside drawing code. Search requires an explicitly submitted query; source responses are bounded and validated before becoming scene data. Static hosting has no map gateway. See [Providers](PROVIDERS.md) for deployment and cache ownership.
