# Attribution

The 3D editor uses MapLibre GL JS (BSD-3-Clause), Three.js (MIT), Earcut (ISC), @mapbox/vector-tile (BSD-3-Clause) and pbf (BSD-3-Clause); notices are included in `public/third-party-notices.txt`. Its global vector tiles are served by OpenFreeMap using the OpenMapTiles schema and OpenStreetMap data (ODbL). The viewer retains map attribution; publicly shared exports need visible credit alongside the work. Local imported models retain their own creator and license, recorded in their placement manifest; they are not distributed with the application.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

## Included snapshots

The files in `public/data/` retain their original OSM IDs, tags, geometry, source endpoint, query bounds and retrieval timestamps. Source metadata is stored under the original `pocketPlaces` key. Base, relation and rail retrieval timestamps may differ; the metadata in each file is authoritative.

| Files in `public/data/` | Query bounds: south, west, north, east |
| --- | --- |
| `xinyi.json`, `xinyi-rail.json` | `[25.026, 121.554, 25.045, 121.575]` |
| `ntu.json`, `ntu-rail.json` | `[25.0075, 121.528, 25.0255, 121.5495]` |
| `tokyo.json`, `tokyo-rail.json` | `[35.6822, 139.6907, 35.7038, 139.7173]` |
| `sapporo.json`, `sapporo-rail.json` | `[43.0487, 141.3397, 43.0703, 141.3693]` |
| `shanghai.json`, `shanghai-rail.json` | `[31.2282, 121.4794, 31.2498, 121.5046]` |
| `beijing.json`, `beijing-rail.json` | `[39.9132, 116.3904, 39.9348, 116.4186]` |
| `seattle.json`, `seattle-rail.json` | `[47.612, -122.35, 47.6354, -122.3154]` |
| `washington.json`, `washington-rail.json` | `[38.8897, -77.0469, 38.9113, -77.0191]` |

Base snapshots include selected roads, buildings, parks, land and water, plus relations for complex polygons. Separate rail snapshots include mapped railway/subway/light-rail/tram geometry and stations/stops. Ways may extend beyond the bounds; ground display is clipped, while projected building silhouettes can extend beyond the geographic edge. Relation handling assembles closed rings, retains inner holes and skips incomplete rings. Coverage is neither complete nor a current survey.

## Images and simulated content

Gallery images and recordings are application exports. No external photograph is bundled or used as a texture. Scene pixels are drawn from map geometry and artistic rules.

Light intensity and colors approximate an artistic district character from building density, tags and station proximity. Vehicles, signals, train movement, dwell times and directions are simulated, with no live traffic or timetable data. Buildings are not asserted to be illuminated or open in reality.

## Landmark supplementation

The original parametric Taipei 101 and Sapporo TV Tower artwork is covered by the project license. No external model meshes, photographs, textures or document images are shipped. Mapped footprints/identities retain their OSM attribution. Height facts, conflicting candidates, review dates and Wikidata revisions are recorded in [landmark sources](data/landmarks/sources-v1.json); intermediate model dimensions are artistic approximations. Wikidata structured entity data is supplied under [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing). Source references are for provenance, not an endorsement by the landmark operators.

Publicly shared map images and animations must carry readable OSM attribution in or alongside their presentation as appropriate to the medium. The 3D map displays attribution in the viewer. Exports include the building-source credits for the captured scene. Metadata or a detached file alone is not a blanket substitute for visible attribution in public uses. See the [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines). Embedded scenes also require attribution. Database redistribution and adaptation remain subject to ODbL; the AGPL program license does not replace the map license.

## Software

Lumen Streets is licensed under [AGPL-3.0-only](LICENSE). [NOTICE](NOTICE) retains the current and preceding project copyright notices. Vite is MIT-licensed build tooling. Canvas 2D is a browser API. gifenc 1.0.3 (MIT) encodes GIF previews. Unmodified Mediabunny 1.56.1 (MPL-2.0) supplies video encoding/container integration. Its source is available in the [exact source package](https://registry.npmjs.org/mediabunny/-/mediabunny-1.56.1.tgz), including the src directory; its MPL license is included in [mediabunny-license.txt](public/mediabunny-license.txt). Mediabunny remains available under MPL-2.0; the combined application is distributed under AGPL-3.0-only. Software notices are included in [third-party-notices.txt](public/third-party-notices.txt), which is also copied into the static build. No remote fonts are used.

## Fonts

Place titles use locally hosted Cormorant Garamond Medium and Noto Serif TC Medium under the SIL Open Font License. Their licenses are included in [cormorant-OFL.txt](public/fonts/cormorant-OFL.txt) and [noto-serif-tc-OFL.txt](public/fonts/noto-serif-tc-OFL.txt). The [font manifest](public/fonts/manifest.json) records source URLs and file hashes.

## Portable scene files

Complete `.lumen.json` files include the original OpenStreetMap snapshots and provenance alongside the program's scene settings. Redistributed map data remains under ODbL; keep its source metadata and copyright/license reference. The read-only player shows linked source attribution. Saving or importing a scene file does not change either the map license or the application's AGPL license.

## Global building context

The automatic height service samples GHS-BUILT-H ANBH 100 m cells and uses them as regional estimates; this is a derived visualization, not endorsement or a survey of individual buildings. Data: European Commission, Joint Research Centre, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Dataset: Pesaresi, M.; Politis, P. (2023), *GHS-BUILT-H R2023A — GHS building height, derived from AW3D30, SRTM30, and Sentinel2 composite (2018)*, JRC. [DOI](https://doi.org/10.2905/85005901-3A49-48DD-9D19-6261354F56FE).

Methodology: Pesaresi, M. et al. (2024), *Advances on the Global Human Settlement Layer by joint assessment of Earth Observation and population survey data*, International Journal of Digital Earth 17(1). [DOI](https://doi.org/10.1080/17538947.2024.2390454). See the [required citation guidance](https://human-settlement.emergency.copernicus.eu/GHSLhowToCite.php).

The server bundles PMTiles (BSD-3-Clause), polygon-clipping (MIT), splaytree (MIT), robust-predicates (Unlicense), and fflate (MIT); complete notices are in `public/third-party-notices.txt`. Python dependencies are installed with their upstream distributions and licenses during deployment setup.
