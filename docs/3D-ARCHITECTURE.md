# Lumen Streets 3D

Facade lighting now uses nine architectural families, muted material palettes, selective crown/contour/wall lighting and red obstruction lights. See [facade design and research](3D-FACADES.md) for the rules, references, resource costs and visual limitations.

[繁體中文](3D-ARCHITECTURE.zh-TW.md)

Lumen Streets uses MapLibre and Three.js to render a continuously navigable city nightscape. The editor, exports and embedded views share one renderer and a bounded active scene.

## Run and use

Use Node.js 24, run `npm ci` and `npm run dev:3d`, and open `http://127.0.0.1:5183/three.html`. The same editor opens at `/index.html`. For production, run `npm run build` then `npm start` on port 5180.

Drag to pan; right-drag to rotate and tilt; scroll to zoom. Horizontal rotation uses a linear 0.25°/pixel response everywhere on the canvas. On phones, use two fingers to zoom and rotate. Explore chooses a preset or searches through the existing server gateway. Settings controls brightness, density, tilt, orbit, resolution and live landmark names. Hide controls creates an uncluttered wallpaper view.

## Implemented

- Global vector tiles load and unload as the camera moves. There is no fixed neighbourhood boundary.
- Each showcase has its own camera (desktop zoom 14.4–14.85, with a 0.65 reduction on phones), with a nearest limit of 16.5 and pitch capped at 55°. Buildings retain full height down to 12.3, fade into the atlas between 12.3 and 11.8, and traffic starts at 12.8.
- Muted champagne road shoulders surround dark asphalt, with sparse lamp highlights and restrained bloom. Subdued blue-grey roofs contrast with grouped ivory and cool window light. Parks retain open grass and groups of instanced trees; mapped water receives camera-oriented shoreline reflections. Hardware depth testing handles facade, landmark and moving-light occlusion.
- The eight existing snapshots preserve OSM height/floor parsing, building assemblies and courtyard holes. A separate geographically selected catalog now supplies 51 landmark assemblies, including the six existing models. Parametric curves and portals become physical triangles. Rectangular gabled roofs have a supported roof generator; unsupported roof types fall back to flat.
- The original traffic simulation supplies seeded demand, one-way handling, following gaps, signals and turning. Snapshot railways retain simulated trains. Retained graph edges preserve traffic when the same snapshot scene is rebuilt.
- PNG, GIF, 30-second to five-minute video, saved scenes, view links, embeds and landmark contribution packages are available in English and Traditional Chinese.

## Rendering design

### Visual baseline

The nightscape should read as illuminated buildings and individual street lights, with space for darkness between them. Roads connect the composition without becoming solid luminous ribbons. Bloom is reserved for the brightest points; reducing road brightness must not simply underexpose the whole scene. The light control shares the default road values with the map style so returning to 100% restores this baseline.

Roof colour stays subdued, while facade bays, window proportions and occupied suites vary deterministically between buildings. These patterns are artistic material variation, not surveyed facade details. Low-resolution facades retain integrated window light rather than turning black. Vegetation is quieter than buildings; water keeps a dark open centre and sparse warm reflections with visible inferred shoreline lights. Source building heights and water outlines remain unchanged.

Traffic uses camera-dependent head/tail visibility and a short exposure sampled along the current road, up to eight metres and two points per vehicle. Stationary cars remain sharp. The display effect retains no frame history and does not alter traffic speed, demand, routes or export checkpoints. The camera range and default aerial framing remain unchanged.

### Graphics backend

MapLibre GL JS 6.9.1 and Three.js 0.186.0 share a **WebGL 2** context and depth buffer. MapLibre handles global geography, camera math, source workers and tile caching. Three.js handles one batched facade mesh, lamps, vehicles and imported landmarks. WebGPU is not implemented.

The shared camera follows [MapLibre’s custom-layer interface](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/). [OpenFreeMap](https://openfreemap.org/quick_start/) supplies the default global tile source.

Bloom copies the completed shared framebuffer once, extracts and blurs bright pixels in two quarter-resolution passes, then composites over the original image. Targets use RGBA8 without depth; city geometry is rendered only once. This adds bandwidth cost, but avoids floating-point targets, shadow maps and thousands of physical light sources.

## Source boundaries

`VITE_LUMEN_TILEJSON_URL` can select a compatible OpenMapTiles TileJSON URL at build time. The default is `https://tiles.openfreemap.org/planet`. The expected layers include building, transportation, water, landuse, landcover and park. Public service availability is not guaranteed; deployments can self-host compatible tiles. No public Overpass endpoint is used for continuous panning. Search uses the inherited bounded gateway.

Near a selected preset with an existing snapshot, its attributed OSM data supplies detailed geometry and topology; vector tiles extend its surroundings. Guangzhou, Kaohsiung, Yokohama and Lower Manhattan use global vector tiles, without new bundled road or rail snapshots. Elsewhere, buildings use vector-tile heights and conservative estimates, and roads use quantized coordinate junctions. This loses tags and original OSM node identity. Global roof shapes, building relations, lanes and grade-separated junctions are not fully represented. Roads and cars at the boundary of a bundled snapshot are not yet a single persistent transport network. Global trains are not implemented.

The renderer requires global tiles even for preset scenes. Network failure is surfaced with Retry; a completely offline preset ground layer remains future work. Preset ground artwork adds contact shadows and soft road lighting. Water, parks, woods, grass and bridge masks are decoded from the same zoom-14 tiles already requested for buildings. Polygon holes retain islands and clearings. A packed coverage texture keeps vegetation clear of roads, water and buildings. Mapped woodland receives instanced low-polygon crowns and trunks; parks receive occasional inferred groves, while explicit grass remains open. Individual tree positions are artistic estimates. Trees share one draw call and appear at neighbourhood zoom levels.

Reflections stretch a bounded field of road lights and inferred shoreline lights toward the camera, clipped to mapped water; they are stylized lighting, not screen-space reflections or a survey of actual lamps. Water outlines are not widened to match artwork. Where terrain geometry reaches its budget, the base map remains visible.

Vegetation and lighting references include [Mapbox Standard](https://docs.mapbox.com/map-styles/guides/standard-styles/) and the controllable city lighting in [MatrixCity](https://city-super.github.io/matrixcity/). Dark surfaces and open unlit areas separate the warm street network from cooler windows.

## Resource ownership

| Resource | Desktop | Mobile profile |
| --- | --- | --- |
| Display pixel ratio ceiling, adaptive | 1.75 | 1.25 |
| Source tile cache entries | 160 | 64 |
| Active facade vertices | 700,000 | 280,000 |
| Landmark vertex reservation, within facade budget | 90,000 | 90,000 |
| Building-detail tiles per view, source zoom 14 | 180 | 96 |
| Compressed building tile cache | 24 MiB | 8 MiB |
| Concurrent building requests | 4 | 2 |
| Distant volume aggregation target | 90,000 | 45,000 |
| Preset ground texture longest edge | 2,560 px | 1,536 px |
| Reflection light texture longest edge | 2,048 px | 1,024 px |
| Water / vegetation vertices, each | 70,000 | 30,000 |
| Environment streetlight points | 30,000 | 30,000 |
| Instanced trees | 6,000 | 2,000 |
| Bridge ribbon vertices | 15,000 | 15,000 |
| Selected vector road features | 3,500 | 1,500 |
| Default cars | 700 | 400, bounded by available roads |
| Map source workers | 4 | 2 |

These budgets exclude browser overhead and the map renderer's active tile buffers. Bloom owns one full-size RGBA8 texture and two quarter-size targets: about 6.7 MiB at 1664 × 936, or 35.6 MiB for a 3840 × 2160 capture. Export restores display-sized targets afterward. Display resolution can be lowered manually; the adaptive mode reduces it when timer pacing degrades. This heuristic is not a GPU benchmark or a frame-rate guarantee.

`CityStream` has one geometry job in flight and one coalesced follow-up, with cancellation and generation checks when the camera moves. Building tiles load independently of the basemap: low-zoom map tiles omit individual buildings, so changing the mesh visibility threshold alone cannot preserve a city. The worker fetches zoom-14 building tiles in stable, centre-first batches, decodes/builds one tile at a time, and caches only compressed buffers. Grouped MultiPolygons are split into individual footprints before ownership checks. Redundant `hide_3d` outlines are skipped. Preset coverage is matched against actual footprints rather than its rectangular query bounds. Buffered fragments belong to the tile containing their bounding-box centre; clipped pieces remain separate. Only one parsed preset is retained. Heights use camera-local metre coordinates to preserve precision.

Detailed facade geometry has a fixed budget. Remaining buildings use oriented instanced volumes with source heights instead of disappearing. If instances exceed their aggregation target, small neighbouring low roofs combine into occupied volumes; tall and broad structures stay separate, so the target is not a hard cap. Simplified volumes approximate footprints and do not retain courtyards. The building count describes represented source pieces, not unique OSM identities or GPU instances. The outer tile limit is separate and explicitly shown when reached; very wide or steep views can still have incomplete outer coverage.

Replacing a scene disposes old geometry, environment light bitmaps/textures and lamp buffers. Stale worker responses close their transferred bitmaps. The preset ground bitmap is reused while its preset is unchanged. Atlas views also release the bloom targets, terrain and traffic graphs, and clear the worker's building cache. Worker and renderer teardown occurs when the page leaves. Hidden tabs stop traffic paints; paused scenes repaint for interactions only. GPU building geometry figures exclude environment resources, ground bitmaps/textures, decoded worker data, map buffers and browser overhead; they are not total-memory claims.

## Exports and sharing

Capture provides desktop, ultrawide, square, tablet and phone ratios, plus the current screen and a custom ratio. Drag the live map to compose; full-screen framing retains the same view when returning to the controls. A viewport-size correction keeps building detail consistent with the full-size scene.

PNG supports a longest edge of 1920, 2560 or 3840 pixels. GIF is six seconds at 10 fps, with a maximum 720-pixel edge. Video is 30–300 seconds at 30 fps, up to a 2560-pixel edge. Mediabunny selects MP4/AVC when available and WebM/VP9 otherwise. Fixed frame timestamps preserve the requested duration independently of encoding speed. Large videos stream to browser temporary storage, with a 1.5 GB output budget; the in-memory fallback is limited to 250 MB.

All three formats use the same soft edge shading, brightness and area controls, optional place title and landmark labels. Cormorant Garamond and Noto Serif TC load from bundled font files. Capture restores the traffic checkpoint, time, playback, resolution and interactions on completion or cancellation. A screen wake lock is requested when supported. Video repeats with a cut at the end.

View links preserve the camera, light, traffic density, playback setting, live landmark-name switch and language. Embeds can also carry captions, landmark labels and edge shading. Scene JSON files retain composition and traffic state; stable road endpoints reconnect vehicles when loading. If map data changes, unmatched traffic restarts. Scene files require online map tiles and keep imported GLBs separate. See the [landmark guide](3D-LANDMARKS.md).

## Source map and validation

| Module | Responsibility |
| --- | --- |
| `src/three/main.js`, `style.css`, `locales.js` | Editor, camera controls and bilingual interface |
| `style.js` | Global night map and road hierarchy |
| `view.js`, `stream.js`, `city.worker.js`, `tiles.js` | Aerial framing, bounded tile requests, cancellation, background geometry and graph preparation |
| `geometry.js`, `geo.js` | Physical meshes, holes, roofs and coordinate boundaries |
| `materials.js`, `layer.js`, `surface.js`, `volumes.js` | Shared GPU materials, ground artwork, distant volumes, depth, lamps and disposal |
| `bloom.js`, `environment.js`, `environment-layer.js` | Framebuffer bloom, bounded terrain masks, vegetation and reflected light |
| `export.js`, `gif.worker.js`, `video.js` | Captures, sequential encoding and rollback |
| `model-import.js`, `contribution.js` | GLB validation, placement and contribution ZIPs |
| `composition.js`, `scene-recipe.js` | Shared typography, framing and saved scene validation |

Run `npm test`, `npm run check:presets`, `npm run check:docs` and `npm run build`. With the development server running, `npm run check:3d:browser` uses installed Microsoft Edge to exercise real exports, rotation, global travel, far-view disposal and a mobile viewport. Generated evidence lives under ignored `artifacts/3d/`. Mobile emulation does not verify physical Android or iPhone performance.

`node scripts/check-3d-aerial.mjs` verifies actual right-drag gestures above/at/below the centre, the closest-zoom clamp, Shanghai city-wide coverage, a global Sapporo view, atlas disposal and portrait framing. Evidence lives under ignored `artifacts/3d-revision/`.

`node scripts/check-3d-art.mjs` uses the development server to capture a fixed Sapporo comparison, verify the two additional + steps, render 3840/1920/3840 PNGs with state restoration, rotate reflections, repeat atlas/reload disposal and inspect a mobile viewport. Evidence lives under ignored `artifacts/3d-art/`; screenshots require visual review, not just passing assertions.

`node scripts/check-3d-facades.mjs` checks the actual GPU seed/hash path for detailed and instanced buildings, using six seeds and three perspective angles. Building seeds use flat interpolation: even tiny interpolation errors can otherwise change window occupancy or facade style between adjacent pixels. The test contrasts the fixed path with a smooth-interpolation control and saves close/rotated Sapporo screenshots under `artifacts/3d-facades/`.

`npm run check:3d:capture` verifies portrait dimensions, full-screen framing, scene restoration, cancellation and the contribution package. Device tests use the physical device separately from browser viewport emulation.

`node scripts/check-3d-landscape.mjs` checks vegetation exclusions using real canvas pixels, grass clearings, feature-order independence and both long-distance and nearby search navigation.

The default global tile schema uses 5 metres when height and level data are absent. These remain `upstream-unknown` render values, not raw OSM measurements. The optional [building-height pipeline](BUILDING-HEIGHTS.md) preserves missing data before tiling, integrates regional evidence offline, and supplies prepared tiles through `VITE_LUMEN_BUILDING_MANIFEST_URL`. Prepared and baseline buffers share the existing cache and concurrency budgets; complete coverage replaces ordinary snapshot buildings while retaining traffic and reviewed landmarks. No global enriched dataset is bundled. See the [upstream height calculation](https://github.com/openmaptiles/openmaptiles/blob/master/layers/building/building.sql).

Showcase cameras live in `src/three/presets.js`, independently of historical snapshots. `showcase-landmarks.json`, `showcase-shapes.js` and `showcase.js` supply reviewed identities/footprints, original silhouettes and geographic selection. The worker admits complete models first, suppresses only their owned map footprints, and spends the remaining vertex budget on ordinary facades. No circular deletion zones are used. Run `node scripts/measure-showcase.mjs` for geometry/storage figures and `node scripts/check-3d-showcase.mjs` for desktop/mobile viewer, labels and scene checks. See the [capacity study](SHOWCASE.md).
