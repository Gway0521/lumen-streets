# 3D roadmap

[繁體中文](3D-ROADMAP.zh-TW.md)

The current preview establishes global movement, WebGL 2 depth rendering, bounded background geometry, the six original landmarks, traffic, short exports and local GLB placement. Work should advance through observable gates rather than replacing the entire renderer at once.

## 1. Visual and device baseline

Review Shanghai, Sapporo, Tokyo and Taipei in landscape and portrait. Tune continuous road light, roof separation, district contrast and skyline silhouettes against actual classic exports. Add subdued vegetation and shoreline reflection without full-screen effects. Test real Android and iPhone devices, sustained travel, heat, context loss and video encoding. Record device/browser, camera, warm-up, frame pacing and memory scope with every measurement.

## 2. Streamed geometry quality

Move from bounded whole-view mesh replacement to spatial chunk reuse, prioritize near tiles and visible landmarks, and use incremental upload budgets per frame. Add hysteresis between LOD levels. Keep distant footprints until replacement chunks are ready. Extend gabled, hipped, pyramidal and curved roofs through shared tested generators, preserve holes, and avoid duplicates between building outlines and parts.

Adopt a richer tile schema when needed: OSM identities, parts, roof tags, transport layers, one-way information and source revisions. Preserve traffic across chunk seams and add global rail routes. Build a practical self-hosted pipeline before relying on unrestricted production traffic through a public service. Support an offline ground layer for the eight snapshots.

## 3. Wallpaper and saved scenes

Extend the fixed-rate video exporter with framing independent of viewport shape, robust long capture, reusable playlists and optional seamless camera loops. A new versioned 3D scene format should retain source revisions, model hashes, renderer semantics and traffic state. Existing 2D scene files remain with their original reader until migration is explicit.

## 4. Community landmarks

Turn local GLB + manifest packages into reviewed submissions. Add authenticated upload, object storage, validation jobs, moderation, attribution, geospatial lookup, revision history and explicit replacement/retention rules. Serve simplified and detailed LODs by projected size. The model store should be replaceable and should not couple the renderer to one hosting provider.

## Release gates

A public 3D release needs an accepted visual comparison, measured physical-device coverage, tested memory plateaus during sustained travel, accurate export claims, recoverable source failures and audited software/map/model attribution. Keep the existing 2D editor available while these gates are open. WebGPU adoption is a separate measured decision, not a prerequisite for the first usable 3D release.
