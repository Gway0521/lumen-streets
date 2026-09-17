# Contribute a landmark

[繁體中文](3D-LANDMARKS.zh-TW.md) · [Architecture](ARCHITECTURE.md)

Bring a building from your city to Lumen Streets. Place a local GLB, check its silhouette, then download a contribution ZIP for GitHub review.

The built-in showcase has 51 original parametric assemblies. Explore the [featured cities and their landmarks](SHOWCASE.md). Imported GLBs have separate limits below.

## Prepare the model

Create an original, low-poly model. Concentrate detail on the roofline, setbacks, openings and distinctive structures that read from above. Use material base colours with restrained warm accents.

Export **glTF 2.0 binary (`.glb`)**, Y up, with one scene and applied transforms. The importer centres the model horizontally, places its lowest point at ground level, and scales it to the height entered in the editor. Rotation turns it about the vertical axis.

| Limit | Value |
| --- | --- |
| File size | 8 MiB |
| Triangles across instances | 20,000 |
| Vertices across instances | 60,000 |
| Nodes | 256 |
| Meshes / materials | 128 / 64 |
| Binary buffers | One embedded buffer |
| Geometry | Static triangles |

Use uncompressed geometry and base-colour materials. Textures, animation, skins, extensions and external resources are not accepted. Materials render unlit; emissive channels are not retained. The importer validates chunks, accessors, node hierarchies and geometry budgets before rendering.

## Place and submit

1. Open **Landmarks** and select the GLB.
2. Enter the building name, creator, license, height in metres and rotation.
3. Move the map centre to its location and choose **Place at map centre**.
4. Rotate and zoom to inspect its relationship to neighbouring buildings.
5. Choose **Download contribution ZIP**, then **Submit on GitHub** and attach the ZIP to the issue.

The package contains `model.glb`, `landmark.json`, `preview.png` and `README.txt`. The manifest records the name, SHA-256, longitude/latitude anchor, height, bearing, creator, license and triangle count. The GLB is preserved byte for byte.

Describe the building and link references for its height and silhouette. State the source and license of any third-party geometry. Identify existing map buildings that should be replaced, and separate annexes that should remain. Review covers geometry, placement, visual quality, attribution and the replacement rule before publication.

Local placement leaves the underlying map geometry in place for inspection. Shared view links and scene files do not contain GLB bytes. Exported images and videos include the placed model; retain the creator and license credit when sharing them.

## Built-in models: accuracy and complexity

The 51 built-in assemblies cover major structures in the featured views and roughly 2–3 km around them. They use original low-polygon silhouettes designed for aerial views. The [catalog](../src/three/showcase-landmarks.json) records bilingual names, OSM identities, anchors, source and display heights, and replacement footprints. Data attribution: © [OpenStreetMap contributors · ODbL](https://www.openstreetmap.org/copyright).

Heights combine reviewed references, OSM tags and documented display estimates. Whole-building heights can differ from the tags on individual footprint parts. Rooflines, facades, curved surfaces, bridge structures and lighting are artistic approximations.

| Structure | Examples | Modeling work |
| --- | --- | --- |
| Stepped towers | Nan Shan Plaza, Four World Trade Center | Proportions, setbacks and placement |
| Historic roofs | Clock Tower, Peace Hotel | Recognisable eaves and roof silhouettes |
| Curved forms | Opera House, MoPOP, cruise terminal | Preserve the shape within a small geometry budget |
| Open structures | Canton Tower, wheels and bridges | Lattices, spokes and cables need the most geometry |

## Measured capacity

Run `node scripts/measure-showcase.mjs [report.json]` to reproduce geometry counts and source/gzip sizes. The current 51 assemblies total **50,355 triangles and 9.221 MiB of vertex attributes** if all were generated together. They are geographically culled. The largest city group is Guangzhou at 15,408 triangles / 2.821 MiB.

The catalog, generators and selection/replacement module total about **179 KiB source / 24 KiB gzip**, excluding existing legacy definitions. These are source measurements, not the site's transfer size. There are no per-building GLB or texture downloads. Each view reserves up to **90,000 landmark vertices**, within the existing total facade budget. Complete assemblies are admitted atomically; an omitted model leaves its ordinary map building intact. Models share the existing facade mesh and draw call.

The current average suggests about 30 simultaneous assemblies, or 2–5 intricate lattice structures, within the geometry allocation. Larger catalogs need regional downloads and a spatial index before device testing. Only these 51 assemblies have been validated. Vertex figures exclude map resources, ordinary buildings, temporary CPU allocations and capture targets.
