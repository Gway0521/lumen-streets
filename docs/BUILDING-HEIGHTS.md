# Building height data

[繁體中文](BUILDING-HEIGHTS.zh-TW.md)

The regional implementation below does not yet satisfy automatic worldwide enrichment. The [global building service design](GLOBAL-BUILDING-SERVICE.md) describes the proposed replacement and its live source-access evidence; that runtime migration is not implemented yet.

The 3D renderer can consume independently prepared building tiles. Preparation preserves original heights, floors, identities and provenance; selects compatible measurements; then fills remaining gaps with estimates. The browser downloads nearby tiles and builds its existing lightweight facade mesh. The legacy scene renderer keeps its original normalization.

This repository supplies a regional preprocessing tool and a runtime contract, **not a hosted global enriched dataset**. OpenFreeMap remains the default until a deployment configures prepared tiles. A 5 m `render_height` in the old OpenMapTiles feed remains an upstream value with unknown provenance: it cannot be recovered as either a measured height or a missing value. It is never relabeled as raw OSM height.

## Sources and selection

[`data/building-sources.json`](../data/building-sources.json) defines sources independently of display cities. Overture is the default footprint base and already integrates OSM; do not blindly stack a second OSM footprint layer over it. A normalized OSM GeoJSON/GeoJSONL or GeoParquet extract can instead be the base. Raw OSM PBF/relations must first be converted to valid footprints with stable IDs and tags.

| Input | Implemented ingestion | Interpretation |
| --- | --- | --- |
| Overture Buildings + building parts | Pinned release, official STAC discovery, spatially filtered GeoParquet | Original nullable heights/floors and property-scoped `sources`; ML and unknown height origins stay estimates |
| Japan PLATEAU | Automatic rectangle discovery and streamed CityGML parsing | Building-owned LoD0 footprint/roof edge, projected LoD1 fallback; `measuredHeight` and `storeysAboveGround`; CRS axes and units checked |
| EUBUCCO v0.2 | Geographic boundary lookup and discovery of available Parquet partitions | Per-attribute `height_source`, floors, confidence interval and original provenance; predictions remain estimates |
| Netherlands 3DBAG | Local normalized GeoJSON/GeoParquet adapter | Roof `b3_h_dak_70p` minus `b3_h_maaiveld`, including negative NAP elevations |
| Other national vectors | Registry entry using `generic`, explicit CRS, method and height definition | No city-name switches; values in metres after normalization |
| Satellite height / regional grids | Local GeoTIFF/COG through Rasterio | Masked footprint samples, NoData/support checks; effective resolution ≥30 m is regional context |

For a local supplement, copy the registry and add a `supplements` entry with `id`, `adapter` (`3dbag` or `generic`), `path`, `crs`, `bounds`, `license`, `attribution`, and, for `generic`, `method`, `definition`, `observed_year` and `release`. Paths resolve relative to the registry file. Generic properties are `height`, `floors`, `min_height` and `roof_height`. For a raster, add a `rasters` entry with `adapter: "raster"`, a local `path`, `band`, `effective_resolution_m`, `definition`, `observed_year`, source ID, license and attribution. A GeoTIFF must identify its CRS and NoData. Native source grids should be used without resampling them to imply finer precision.

Height selection is deliberately conservative:

1. Reject non-finite, negative, ambiguous, implausible (>1200 m) or vertically inconsistent values. Absolute elevation with an unknown ground reference is unusable as a building height. A null source value remains null even after enrichment.
2. Match intersecting footprints in a fixed equal-area CRS. Require intersection-over-union ≥0.65 and intersection/smaller-area ≥0.8. Reject near-tied matches and multiple base footprints claiming the same supplemental footprint. Whole buildings cannot donate total heights to parts. Holes participate in matching.
3. Prefer survey/mapped heights, then floor-derived heights, then model/fine raster estimates, then regional estimates. Within a tier, score match quality, definition compatibility and observation year; survey evidence receives a small bonus. Source release and construction dates are **not** observation dates. Unknown dates remain unknown. This is a versioned selection heuristic, not a calibrated accuracy probability.
4. If no source works, use a median of at least five observed buildings of the same use and area stratum in a 2 km equal-area cell; otherwise use a conservative, deterministic use/area fallback. These values remain marked `regional` or `fallback`. Statistics depend on the available extract; use consistent partitions and halos for a production dataset.
5. Retain alternatives and rejected matches in the audit archive. Flag observed-height disagreement exceeding both 5 m and 25% of the selected height. A reviewed landmark model still owns its height and geometry in the renderer.

Floor conversion currently assumes 3.2 m per floor plus available roof height and records that assumption. Building parts and their hidden parent outlines do not seed regional statistics: several pieces of one skyscraper are not independent neighbouring observations. PLATEAU's dataset year is recorded as the release, not fabricated as a survey date. EUBUCCO source-specific `observation_years` and `definitions` may be supplied in its registry entry after reviewing its input metadata. Unsupported GML surfaces/xlinks are not converted into guessed building bounds. The parser supports CityGML 2 building/part LoD0/LoD1 data; it is not a general CityGML 3 model converter.

## Build a partition

Use Python 3.12 in a separate environment. These dependencies are offline tools; the website has no new dependencies.

```sh
python -m venv .cache/building-venv
# Activate the environment using your shell's activation command.
python -m pip install -r scripts/buildings/requirements.txt
python -m unittest discover -s scripts/buildings -p test_buildings.py
python scripts/buildings/build.py --bounds 139.735 35.655 139.74 35.66 --output .cache/building-tiles/tokyo-v1
```

Bounds are west, south, east, north in WGS84. Bounds snap outward to complete zoom-14 tiles. A small query halo supplies match candidates and full boundary footprints. The default limits are 64 tiles, 250,000 records per source, 1 GiB DuckDB memory, four query/discovery threads, 256 MiB per downloaded source file and 2 GiB total direct downloads per run. DuckDB range-query traffic has a separate transport and is not included in that download counter. Split larger jobs geographically; the tool does not load the world into memory. Downloaded metadata and CityGML files are cached by URL and verified by SHA-256. Remote Parquet inputs record pinned release/URLs and query bounds; the audit is the retained extract for reproducibility, not a promise that upstream URLs remain immutable.

The initial Overture STAC index discovery is cached per release. It queries only geographically intersecting data assets, including building parts. PLATEAU discovers building files within the requested rectangle. EUBUCCO intersects its own boundaries and discovers its actual storage partitions (currently NUTS2); it does not derive filenames from display cities or assume the NUTS3 record ID is the storage key. A configured provider error fails the build instead of silently advertising a partially enriched region. An empty national query may legitimately supply no matches.

The output directory must be new or empty:

- `manifest.json`: version, revision, complete tile coverage, URLs and source credits; written last.
- `tiles/14/x/y.json`: uncut GeoJSON footprints with compact height provenance. Empty covered tiles are real empty collections, not missing files. Each tile must fit the 8 MiB decoded budget.
- `audit.jsonl.gz`: raw properties, nullable input values, normalized candidates, matches, rejections and selected values. Keep this with the published derivative database.
- `report.json`: input receipts, source configuration, selection counts, conflicts and output digest.

To combine disjoint partitions, keep their directories together and generate a shared manifest:

```sh
python scripts/buildings/catalog.py .cache/building-tiles/tokyo-v1/manifest.json .cache/building-tiles/paris-v1/manifest.json --output .cache/building-tiles/manifest-v1.json
```

Overlapping partitions are rejected. Publish new immutable versions rather than overwriting a manifest's tile contents. A catalog supports up to 4096 regions; planet-scale orchestration and hierarchical catalogs are future work. GeoJSON was chosen for an inspectable first implementation; use HTTP gzip/Brotli. Production global coverage will also need measured storage/egress, scheduling, partition consolidation and potentially MVT/PMTiles encoding. Neither a planet-sized dataset nor an external service is created by installing this repository.

## Connect the browser

Serve the output as static files with compression, correct MIME types and CORS if hosted elsewhere. Configure on the build machine, then rebuild:

```dotenv
VITE_LUMEN_BUILDING_MANIFEST_URL=/building-tiles/v1/manifest.json
```

`VITE_LUMEN_TILEJSON_URL` still supplies roads, water and vegetation. Prepared buildings replace ordinary snapshot/tile buildings in completed coverage; outside coverage the current source remains available. Traffic and landmark models remain independent. Uncut footprints repeat in intersecting tiles and stable IDs deduplicate them within a view. At boundaries against a different footprint provider, small mismatches or duplicates can remain; a production dataset should extend beyond the intended viewing area and review those transitions.

The loader retains the existing 4/2 desktop/mobile request concurrency and shares a 24/8 MiB cache between base and prepared tile buffers. JSON tile buffers are decoded one tile at a time. Detailed and simplified geometry use the same selected physical height. Download limits are enforced while streaming, cancelled jobs cannot populate the cache after abort, and missing advertised tiles produce the existing Retry state. New country rules run exclusively in preprocessing.

The building-source disclosure appears in both interface languages. Prepared source credits accompany captured frames. Layer diagnostics report `preparedTiles`, `heightSummary` and `heightRevision`; counts describe source pieces admitted by the loader, before landmark suppression, not surveyed buildings or GPU draw calls. Existing 3D scene files still depend on the deployment's online source revision; the legacy read-only player is unchanged.

## Data review and licensing

The application remains AGPL-3.0-only. Data licenses apply separately. The pipeline accepts named, reviewed redistributable licenses; a label in a custom registry does not verify the operator's permission to use that data. Retain attribution, input receipts and access to derivative data as required by the respective source. Review the upstream terms before publishing a new dataset.

| Reference evaluated | Recommended role / limitation |
| --- | --- |
| [Overture Buildings](https://docs.overturemaps.org/guides/buildings/) and [attribution](https://docs.overturemaps.org/attribution/) | Primary footprint base; source-scoped height provenance is essential |
| [PLATEAU height specification](https://www.mlit.go.jp/plateaudocument02/tocC/tocC_03/tocC_03_02/tocC_03_02_03/) and [API](https://docs.plateauview.mlit.go.jp/datasets/citygml/) | National enrichment where available; measured height aims at ground-to-top but acquisition/noise filtering affects it; API is experimental |
| [EUBUCCO schema](https://docs.eubucco.com/v0.2/data-format/schema/) and [license](https://docs.eubucco.com/v0.2/license/) | Useful European enrichment; per-attribute predictions/merged values and definition uncertainty must survive. Exclude `gov-czechia-prague` and `gov-italy-abruzzo` for the common ODbL pipeline; these are documented SA/NC exceptions. The adapter also rejects attributes naming either source |
| [3DBAG](https://docs.3dbag.nl/en/schema/layers/) | Strong Netherlands supplement; roof heights are NAP elevations, not extrusion heights |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | Optional footprint/ML height input; missing height is -1. Footprint confidence is not height confidence; Overture already includes Microsoft data |
| [GlobalBuildingAtlas terms](https://tubvsig-so2sat-vm1.srv.mwn.de/terms_of_use.html) | Research comparison; CC BY-NC 4.0 is unsuitable for the unrestricted default distribution |
| [GHS-OBAT / GHS-BUILT-H](https://build-up.ec.europa.eu/system/files/2025-08/bu81ndb0Mr_20_08_2025_101707.pdf) | Global supplementary/context estimates. A footprint-linked attribute derived from a coarse grid is still an estimate |
| [Google Open Buildings 2.5D](https://sites.research.google/gr/open-buildings/temporal/) | Fine raster estimation in its covered Global South regions; it is not a worldwide/Japan/Taiwan height source. Effective resolution differs from output pixel spacing |
| [UT-GLOBUS paper](https://arxiv.org/abs/2205.12224) | Modeled building-level complement; assess individual distribution coverage, age and terms before ingestion |
| [CNBH-10m](https://zenodo.org/records/7827315) | China raster fallback, not per-building surveyed heights; no default remote downloader |
| [Taiwan NLSC announcement](https://www.nlsc.gov.tw/NLSC_Content.aspx?n=11987&s=280023) | Potential national supplement; public viewing/service access does not itself establish permission for bulk extraction and derivative redistribution. No automatic scraper or bulk integration is enabled |
| [WSF 3D](https://b.geoservice.dlr.de/web/maps/eoc%3Awsf3d) | 90 m regional height context, not a measured height for each building |
| [Microsoft TEMPO](https://github.com/microsoft/buildings/blob/main/README.md) and [paper](https://arxiv.org/abs/2511.12104) | Temporal density/height context; its 37.6 m prediction scale should not be presented as individual-building precision |
| [Re:Earth Buildings](https://github.com/reearth/reearth-buildings) | Useful reference for tiled Overture delivery. Its edge-generated 3D Tiles/glTF service is a different rendering contract, not a substitute for resolving raw height provenance |
| [VoxCity](https://github.com/kunifujiwara/VoxCity) | Useful precedent for geographic provider selection and Python preprocessing; importing its voxel/simulation stack into the browser is unnecessary |

The remote adapters above and local vector/raster adapters are implemented. Automatic download adapters for every evaluated dataset, full national/continental builds, publication and planet-wide validation are not claimed.
