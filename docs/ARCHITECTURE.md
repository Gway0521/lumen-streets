# Architecture

[繁體中文](ARCHITECTURE.zh-TW.md)

MapLibre GL JS and Three.js share a WebGL2 context and depth buffer. MapLibre handles the map, camera and base tiles; Three.js renders buildings, landmarks, vegetation and moving lights. The editor, captures and embeds use the same rendering path.

## Data flow

1. The camera selects zoom-14 tiles around the view.
2. The Node building service reads Overture PMTiles using HTTP ranges. Python workers add geographically matched height data in the background.
3. A browser worker builds facade geometry, landmark silhouettes, terrain masks and traffic graphs.
4. The renderer replaces the active scene and disposes previous GPU resources. Capture freezes building revisions and traffic state, then restores the live scene afterward.

OpenFreeMap supplies roads, water, landcover and the flat basemap. Attributed snapshots add road and railway topology in their coverage areas. Building data and attribution come from the [height service](BUILDING-HEIGHTS.md). Search uses the [server gateway](PROVIDERS.md).

## Rendering

Buildings use a batched facade mesh with nine procedural architectural families. Window occupancy, material tone and decorative lighting use stable seeds. More distant buildings use instanced volumes, which simplify footprints and courtyards. The 51 reviewed [landmark assemblies](SHOWCASE.md) replace their owned footprints and share the facade mesh.

Trees use instancing. Water reflections sample road and inferred shoreline lights within mapped water. Bloom uses one full-size RGBA8 copy and two quarter-size passes. See [art direction](ART_DIRECTION.md) and [facades](3D-FACADES.md).

Traffic follows seeded demand, one-way roads, signals and turning rules. Snapshot railway coverage supports simulated trains. The simulation clock drives animation and export timestamps.

## Resource budgets

| Resource | Desktop | Mobile profile |
| --- | ---: | ---: |
| Adaptive pixel-ratio ceiling | 1.75 | 1.25 |
| Detailed facade vertices | 700,000 | 280,000 |
| Landmark reservation within that budget | 90,000 | 90,000 |
| Building tiles per view | 180 | 96 |
| Encoded building cache | 24 MiB | 8 MiB |
| Concurrent building requests | 4 | 2 |
| Distant-volume aggregation target | 90,000 | 45,000 |
| Water / vegetation vertices, each | 70,000 | 30,000 |
| Trees | 6,000 | 2,000 |
| Default vehicles, subject to road capacity | 700 | 400 |

These figures exclude browser, MapLibre, worker and driver overhead. Wide views may reach the outer tile limit, which is reported in the interface. Landmark assemblies are admitted whole. The distant-volume target is approximate because tall and broad buildings remain separate.

CityStream keeps one geometry job in flight and one coalesced follow-up. Generation checks reject stale responses; cancelled bitmaps and replaced textures are closed. Encoded tile buffers are cached, while decoded features are temporary. Atlas views release detailed city resources. Hidden tabs stop traffic paints; paused scenes repaint for interactions.

## Module map

| Module | Responsibility |
| --- | --- |
| src/three/main.js, locales.js, style.css | Editor and bilingual controls |
| src/three/stream.js, city.worker.js, tiles.js | Tile loading, cancellation and geometry jobs |
| src/three/geometry.js, building-source.js | Meshes, footprints, parts and holes |
| src/three/layer.js, materials.js, volumes.js | GPU scene and materials |
| src/three/environment.js, surface.js, bloom.js | Terrain, vegetation, reflections and bloom |
| src/three/export.js, video.js, composition.js | Capture, encoding, framing and titles |
| src/three/model-import.js, contribution.js | GLB validation and contribution packages |
| server/buildings/ and scripts/buildings/ | Global building delivery and enrichment |
| src/player/, src/engine/, src/scene/ | Read-only compatibility for earlier scene files |

## Boundaries

The renderer needs online tiles, including for presets. Building measurements and Overture footprint coverage vary geographically. Road tiles omit some original OSM topology; traffic is not persistent across every tile/snapshot seam. Global trains and fully offline scenes remain on the [roadmap](ROADMAP.md).

The Canvas player retains versioned geometry and scene contracts for earlier files. See [Scenes](SCENES.md) and [Testing](TESTING.md).
