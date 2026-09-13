# Map data and providers

## Bundled data

Sixteen JSON files contain eight base snapshots and their corresponding rail snapshots. They retain OSM identifiers, tags, original geometry and retrieval metadata. The metadata key `pocketPlaces` is retained for compatibility and provenance. It is not a new map source.

The app loads bundled scenes without external map requests. The included Node server provides search and imports in both development and production. Data is incomplete in places, particularly building outlines and relation rings. A missing feature does not establish that an area is empty. Lighting is synthesized from map features, not real population or radiance data.

See [ATTRIBUTION.md](../ATTRIBUTION.md) for exact extents and licensing. `src/regions.json` centers use longitude/latitude, while query bboxes use south/west/north/east. Internal geometry is in local projected meters. Make coordinate order explicit at every adapter boundary.

## Importing a place

Submit place query → select candidate → select centered bounds → validate bounds and budget → retrieve/cache source → normalize geometry → generate scene. The implemented selector offers 1, 2 and 4 km squares, and rejects requests that exceed measured resource limits. These are area choices, not claims that entire cities will fit.

Separate geocoding from geometry retrieval. Use configurable adapters so deployments can switch providers without changing the renderer. Cache immutable results by source version, query/bounds and fingerprint. Keep required attribution and provider terms with every cached scene. Avoid background prefetch across unrelated regions.

Included maps remain available when external services fail. Search uses configurable Photon and Overpass endpoints; a static-only deployment has no search API. See [Map services](PROVIDERS.md) for provider configuration, caching and request limits.

## Optional maintenance scripts

The existing `scripts/fetch_maps.py`, `fetch_relations.py`, and `fetch_rail.py` retrieve bounded preset snapshots for maintenance. They are not production service code and are not run by installation, tests or CI. They may write data files; inspect their options and work on a dedicated branch before refreshing data. Base files may be reused if they already exist; record the actual retrieval metadata rather than assuming a command refreshed everything.

Python 3 is required only for these scripts. Review the endpoint's current policy before invoking them. The existing stored snapshots are sufficient for normal development.

## Input boundary

The import boundary validates finite coordinates, bounding-box ordering, projection limits, maximum area, bytes and elements, supported schema, relation complexity and tag lengths. Treat tags as text. Do not allow arbitrary URLs to become server fetch targets. Credentials stay server-side. The map unit/browser suites exercise malformed data, quota/partial failures, cancellations and retries. See [Map services](PROVIDERS.md) for numeric limits.

## Sharing and licensing

Code and map data have different licenses. Publicly shared images and animations need readable OSM attribution in or alongside their presentation, as appropriate to the medium; see [Attribution](../ATTRIBUTION.md). The player retains a visible attribution link. Distributing raw or adapted databases may carry ODbL obligations beyond image attribution; consult the [OSM copyright page](https://www.openstreetmap.org/copyright) and [ODbL text](https://opendatacommons.org/licenses/odbl/1-0/). The program license does not replace ODbL for bundled map data.
