# Lumen Streets 3D

[繁體中文](3D-ARCHITECTURE.zh-TW.md)

The 3D edition is a development preview alongside the original editor. It brings Aerial Gold into a continuously navigable map with true depth, camera rotation and a bounded active scene. It is not yet a replacement release for the classic editor.

## Run and use

Use Node.js 24, run `npm ci` and `npm run dev:3d`, and open `http://127.0.0.1:5183/three.html`. The original editor remains at `/index.html`. For production, run `npm run build` then `npm start`; visit `/three.html` on port 5180.

Drag to pan; right-drag to rotate and tilt; scroll to zoom. On phones, use two fingers to zoom and rotate. Explore chooses a preset or searches through the existing server gateway. Light & motion controls brightness, density, tilt, orbit and resolution. Hide controls creates an uncluttered wallpaper view.

## Implemented

- Global vector tiles load and unload as the camera moves. There is no fixed neighbourhood boundary.
- A dark atlas at low zoom gives way to height extrusions, then facade windows, lamps and traffic. Zoom is bounded at 16.8 and pitch at 60 degrees from vertical to maintain aerial framing.
- Warm continuous roads, cool restrained roofs, irregular window occupancy and dark water/parks preserve the original visual direction. Hardware depth testing handles facade, landmark and moving-light occlusion.
- The eight existing snapshots preserve OSM height/floor parsing, building assemblies, courtyard holes and six reviewed landmark models. Parametric curves and portals become physical triangles. Rectangular gabled roofs have a supported roof generator; unsupported roof types fall back to flat.
- The original traffic simulation supplies seeded demand, one-way handling, following gaps, signals and turning. Snapshot railways retain simulated trains. Retained graph edges preserve traffic when the same snapshot scene is rebuilt.
- PNG, GIF and short video export, view links, embed mode and a bounded local GLB importer are available in English and Traditional Chinese.

## Renderer decision

MapLibre GL JS 6.9.1 and Three.js 0.186.0 share a **WebGL 2** context and depth buffer. MapLibre handles global geography, camera math, source workers and tile caching. Three.js handles one batched facade mesh, lamps, vehicles and imported landmarks. WebGPU is not implemented.

The reference projects informed the division of work, not the source artwork. [Streets GL](https://github.com/StrandedKitty/streets-gl) builds OSM geometry from vector tiles and uses a custom WebGL 2 renderer with an extensive postprocessing pipeline. Its documented recommendation for a discrete GPU is unsuitable as this project's mobile baseline. [MapLibre's custom-layer example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/) documents sharing a camera and context with Three.js. [OpenFreeMap](https://openfreemap.org/quick_start/) supplies an initial OpenMapTiles-compatible global source.

We use layered road glow and shader windows instead of full-scene bloom, screen-space reflections, shadow maps or thousands of lights. These effects would spend bandwidth on every pixel. A future WebGPU backend needs measured visual or performance benefits before taking on a second rendering path.

## Source boundaries

`VITE_LUMEN_TILEJSON_URL` can select a compatible OpenMapTiles TileJSON URL at build time. The default is `https://tiles.openfreemap.org/planet`. The expected layers include building, transportation, water, landuse, landcover and park. Public service availability is not guaranteed; deployments can self-host compatible tiles. No public Overpass endpoint is used for continuous panning. Search uses the inherited bounded gateway.

Near a selected preset, the original attributed OSM snapshot supplies detailed geometry and topology; vector tiles extend its surroundings. Elsewhere, buildings use vector-tile heights and conservative estimates, and roads use quantized coordinate junctions. This loses tags and original OSM node identity. Global roof shapes, building relations, lanes and grade-separated junctions are not fully represented. Roads and cars at the boundary of a bundled snapshot are not yet a single persistent transport network. Global trains are not implemented.

The 3D preview currently requires global tiles even for preset scenes. Network failure is surfaced with Retry; a completely offline preset ground layer remains future work. Water reflections and dense tree canopies from the classic renderer have not yet been reproduced in 3D.

## Resource ownership

| Resource | Desktop | Mobile profile |
| --- | --- | --- |
| Display pixel ratio ceiling, adaptive | 1.75 | 1.25 |
| Source tile cache entries | 160 | 64 |
| Active facade vertices | 700,000 | 280,000 |
| Selected vector building features | 12,000 | 4,500 |
| Selected vector road features | 3,500 | 1,500 |
| Default cars | 700 | 400, bounded by available roads |
| Map source workers | 4 | 2 |

These budgets exclude browser overhead and the map renderer's active tile buffers. Display resolution can be lowered manually; the adaptive mode reduces it when timer pacing degrades. This heuristic is not a GPU benchmark or a frame-rate guarantee.

`CityStream` has one geometry job in flight and one coalesced follow-up, with generation checks on city changes. The worker retains only one parsed preset, creates transferable typed arrays, and releases temporary build data. It does not keep a growing cache of generated cities. Heights use camera-local metre coordinates to preserve precision. Identical vector fragments are deduplicated by source identity and geometry; different clipped fragments are retained.

Replacing a scene explicitly disposes old geometry and lamp buffers. Distant views remove facade geometry, traffic graphs and lamps. The map tile cache remains bounded across travel. Worker and renderer teardown occurs when the page leaves. Hidden tabs stop traffic paints; paused scenes repaint for interactions only. A geometry limit may leave some buildings as footprints and is disclosed in the status text.

## Exports and sharing

PNG uses the current aspect ratio with a longest edge of 1920, 2560 or 3840 pixels. Portrait output follows a portrait viewport. GIF is six seconds, 10 fps, at most 720 pixels on its longest edge, using one fixed palette and one frame in flight. Video uses WebCodecs through Mediabunny at fixed 30 fps timestamps, six, fifteen or thirty seconds, selecting MP4/AVC when available or WebM/VP9. Video dimensions are even. Frames are rendered sequentially with encoder backpressure, so encoding speed does not shorten the result. The inherited temporary-file storage streams output; jobs above 1920 px require browser temporary-file support. Encoded output is capped at 128 MiB. Long wallpaper loops remain future work.

Capture freezes interaction and saves the simulation checkpoint, time, playback and resolution. Its frame sequence uses the same renderer. Completion, failure or cancellation restores the editor state. This avoids a second full map/context allocation, but temporarily occupies the editor. Every output includes map credit. A real video is not promised to loop seamlessly.

View links preserve the camera, glow, density, preset and language. Embed mode hides the editor controls. Tiles are fetched again and traffic restarts: these are view links, not self-contained reproducible scene files. Imported GLBs remain local and are excluded from links. See the [model guide](3D-LANDMARKS.md).

## Source map and validation

| Module | Responsibility |
| --- | --- |
| `src/three/main.js`, `style.css`, `locales.js` | Editor, camera controls and bilingual interface |
| `style.js` | Global night map and road hierarchy |
| `stream.js`, `city.worker.js` | Bounded source selection, background building and graph preparation |
| `geometry.js`, `geo.js` | Physical meshes, holes, roofs and coordinate boundaries |
| `materials.js`, `layer.js` | Shared GPU materials, depth, lamps, vehicles and disposal |
| `export.js`, `gif.worker.js`, `video.js` | Captures, sequential encoding and rollback |
| `model-import.js` | Bounded GLB validation and local placement |

Run `npm test`, `npm run check:presets`, `npm run check:docs` and `npm run build`. With the development server running, `npm run check:3d:browser` uses installed Microsoft Edge to exercise real exports, rotation, global travel, far-view disposal and a mobile viewport. Generated evidence lives under ignored `artifacts/3d/`. Mobile emulation does not verify physical Android or iPhone performance.
