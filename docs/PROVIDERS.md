# Map services

The default [global building service](GLOBAL-BUILDING-SERVICE.md) reads Overture PMTiles by HTTP Range and automatically enriches missing heights with GHS-BUILT-H regional context and geographically matched PLATEAU/EUBUCCO. It runs in the existing Node deployment with bounded Python background workers. No visitor or city-specific configuration is required. The basemap below supplies roads and terrain.

The 3D editor streams OpenMapTiles-compatible vector tiles directly from OpenFreeMap by default. Set `VITE_LUMEN_TILEJSON_URL` on the build machine to choose another compatible source; rebuild after changing it. The TileJSON, tiles and glyphs must be reachable from visitors' browsers. All preset views also require this service. Update provider attribution when changing sources. Continuous panning does not call Overpass; the bounded area-import API described below remains for legacy tooling.

The Node server includes place search and bounded map imports. Run `npm start` after building; see [Hosting](HOSTING.md) for server settings. The website and `/api/` share one origin. Static-only `dist/` hides search when no API is available.

Map query version `overpass-area-v2` includes standalone building parts, building relations and tower/mast nodes and ways, along with their member geometry. The cache key includes this version so old query results are not reused as new coverage. Readers still accept cached/imported v1 snapshots. Landmark supplementation is an offline maintenance step; scene generation makes no per-building external requests. See [Buildings](BUILDINGS.md).

## Bundled maps and maintenance

Eight bundled places each have a base snapshot and a rail snapshot in `public/data/`. They retain OpenStreetMap IDs, tags, geometry and retrieval metadata, including the legacy `pocketPlaces` metadata key. These snapshots require no upstream request, but the 3D preset views still need online vector tiles for the basemap and surrounding geometry.

`src/regions.json` centres use longitude/latitude; query bounds use south/west/north/east. Rendering uses local projected metres. Preserve coordinate order and source metadata when updating an adapter. Snapshot extents and licenses are listed in [Attribution](../ATTRIBUTION.md).

The optional Python 3 scripts `scripts/fetch_maps.py`, `fetch_relations.py` and `fetch_rail.py` retrieve preset data. Inspect their options before running them: they write snapshots and may reuse existing base files. Review the provider's current policy, retain actual retrieval dates, and run `npm run check:presets` after a refresh. Installation and CI use the bundled snapshots.

## Data sources

| Purpose | Default endpoint | Configuration |
| --- | --- | --- |
| Place search | `https://photon.komoot.io/api/` | `LUMEN_PHOTON_URL` |
| Street/building/rail geometry | `https://overpass-api.de/api/interpreter` | `LUMEN_OVERPASS_URL` |
| Area preview | Standard OpenStreetMap tiles | Build-time `VITE_LUMEN_TILE_URL`; update attribution in `src/search/ui.js` too |

Photon's [public demo](https://github.com/komoot/photon#demo-server) permits reasonable project use but may throttle extensive use and offers no availability guarantee. [Overpass](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) is shared infrastructure too. Defaults suit modest traffic. For sustained growth, arrange suitable capacity or compatible hosted endpoints before raising limits.

Search is submitted explicitly, never on each keystroke, and returns up to six results. English requests prefer English names; Traditional Chinese retains the provider's native-name fallback. Only administrators set upstream HTTPS URLs. Visitors cannot supply URLs, headers or Overpass code; queries are generated from validated numeric bounds and redirects are rejected.

Preview tiles load after selecting a result, with browser caching and visible attribution. No tile proxy, bulk downloader or prefetch is included. Follow the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/); automated browser checks mock tiles. A replacement needs its own attribution and suitable terms. `VITE_` values are public browser code, never secrets.

## Production limits

- Exact public Host and same-origin checks; JSON bodies up to 4 KB, search text 2–120 characters, and 1/2/4 km squares excluding poles and date-line crossings.
- Each client gets 30 API requests/minute and two concurrent operations. The process permits 16 concurrent API operations and 10,000 recent client buckets. IPv6 addresses share a /64 bucket. With `LUMEN_TRUST_PROXY=1`, the loopback proxy must overwrite the header selected by `LUMEN_PROXY_IP_HEADER`: `x-lumen-client-ip` by default, or `cf-connecting-ip` for direct Cloudflare Tunnel connections. Other forwarded headers are ignored.
- One active request per upstream, at least 1.5 seconds between starts, and a 40-second deadline. Provider cooldowns are honoured without automatic retry or fallback hosts.
- Default allowances per process/UTC day: 1,000 geocodes, 300 geometry requests (including optional rail), and 512 MB received. Configure `LUMEN_SEARCH_DAILY_LIMIT`, `LUMEN_MAP_DAILY_LIMIT` and `LUMEN_CACHE_MB`. Cache hits consume no upstream requests. These are application budgets, not provider entitlements.
- Geocoding responses are capped at 1 MB; geometry at 24 MB. Element, vertex and relation limits apply before scene creation. Dense 4 km areas can be rejected. Optional rail failure leaves a usable street scene with a notice.

The Vite development gateway accepts loopback requests only and uses smaller 100/60-request, 128 MB daily limits. Both servers share the provider adapters and validators.

## Cache, privacy and operations

`LUMEN_CACHE_DIR` defaults to `.cache/maps`; systemd uses `/var/lib/lumen-streets/maps`. Search results expire after a day, geometry after seven days. Oldest-written entries are evicted to stay within `LUMEN_CACHE_MB`. Writes are atomic; counts, bytes and cooldowns survive restart. Run one process per cache directory. Horizontal scaling needs shared limits and cache coordination.

Keys hash adapter version, endpoint, normalized query/language or bounds/rail kind. Snapshots retain source URL, retrieval time and content fingerprint. Queries go to Photon, bounds to Overpass, and browser tile requests go to the tile provider. Application logs do not record queries, coordinates or visitor IPs. Server errors log a short code; IP buckets live in temporary memory. Cache files contain result names and geographic data; keep them outside the web root.

The browser verifies fingerprints and bounds before importing immutable scene data. Complete scene files retain sources/settings independently of the cache. Imported-map links do not create public storage automatically: share a scene file, or host it beside the player. Preserve OpenStreetMap/ODbL attribution with public artwork and data.

Monitor the service log, cache usage and provider 429/5xx responses. Deleting the cache removes quota state too; do not use this to bypass provider cooldowns. Included maps and saved scenes remain usable during provider outages.
