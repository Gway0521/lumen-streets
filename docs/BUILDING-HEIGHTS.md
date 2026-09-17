# Building data and heights

[繁體中文](BUILDING-HEIGHTS.zh-TW.md)

Every map location uses the same building service. Node reads the requested part of Overture's global PMTiles archive; Python workers discover and match regional height sources in the background. Footprint coverage and measurement quality vary geographically.

## Sources

| Source | Use |
| --- | --- |
| Overture Buildings | Footprints, parts, nullable height/floor values and property-level provenance from a pinned release |
| GHS-BUILT-H R2023A | 2018 ANBH data at 100 m resolution; footprint samples provide regional height context |
| Japan PLATEAU | Geographic discovery of CityGML building/part footprints, measured heights and storeys |
| EUBUCCO v0.2 | Geographic partition discovery, footprint matching and per-attribute provenance |

The [source registry](../data/building-sources.json) records releases and access rules. GHS cell means are regional estimates, not measurements of individual buildings. ML-derived and unknown-origin heights retain estimate status. PLATEAU supports CityGML 2 LoD0/LoD1 geometry; unsupported surfaces are skipped. Source credits accompany each tile and capture; see [Attribution](../ATTRIBUTION.md).

## Height selection

The resolver prefers compatible mapped or surveyed heights, then floor-derived values, fine estimates, regional context and a deterministic use/footprint fallback. Floors use 3.2 metres per storey plus available roof height. Raw missing values stay null independently of the display height.

Values must be finite, vertically consistent and at most 1200 metres. Supplemental footprints require intersection-over-union of at least 0.65 and intersection/smaller-area of at least 0.8; near-tied or multiply claimed matches are rejected. Whole-building heights do not transfer to parts. Heights with incompatible elevation references are rejected. Reviewed landmark geometry keeps its own height.

## Delivery and background work

The browser requests /api/buildings/manifest.json and /api/buildings/14/x/y.json. The version 2 manifest supplies a global tile template. Clipped Overture fragments are reassembled by GERS identity, preserving holes, parts and minimum heights. Reconstruction is bounded to 25 tiles; responses are limited to 8 MiB decoded.

Tiles use the compact lumen-buildings-1 dictionary format, gzip and ETags. The browser expands one tile at a time, retaining raw nulls and provenance. Desktop/mobile requests use concurrency 4/2 and encoded caches of 24/8 MiB.

An initial view can display estimates while workers load better data. Pending views refresh while idle after 30 seconds; partial results are reconsidered after an hour. Export holds the current revision until it finishes. Processing states distinguish pending, complete, partial and failed work.

GHS and national sources have separate bounded queues, each with one worker and up to 96 queued jobs. Jobs are shared between visitors and publish results atomically. Cache keys include source release, registry and resolver version. Retained data budgets are 256 MiB results, 512 MiB raw tiles, 512 MiB work files and 2 GiB sources, plus bounded active work and the Python environment. See [Hosting](HOSTING.md).

## Offline analysis

The optional Python tool produces reproducible geographic extracts and audit files. From the repository root, prepare the environment once with `npm run setup:buildings`.

Linux / macOS:

```sh
./.cache/building-venv/bin/python scripts/buildings/build.py --bounds 139.735 35.655 139.74 35.66 --output .cache/building-tiles/sample
```

Windows PowerShell:

```powershell
.\.cache\building-venv\Scripts\python.exe scripts/buildings/build.py --bounds 139.735 35.655 139.74 35.66 --output .cache/building-tiles/sample
```

Bounds are west, south, east, north in WGS84; the output directory must be new or empty. Outputs include tile GeoJSON, a version 1 inventory manifest, an audit archive and a report with source receipts. This inventory format is for offline analysis; the website uses the global service contract above.

The offline registry can add local normalized 3DBAG/generic vectors or GeoTIFF rasters with explicit CRS, height definition, effective resolution, source and license. Use --help for options. A median fallback in offline analysis requires at least five independent observed buildings in the same use/area stratum; online estimates use geographically stable source data.

Run Python normalization/matching tests and Node service/cache tests as described in [Testing](TESTING.md).
