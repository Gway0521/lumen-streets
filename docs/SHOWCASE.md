# Showcase locations and landmarks

[繁體中文：完整清單與容量評估](SHOWCASE.zh-TW.md) · [Architecture](ARCHITECTURE.md)

The showcase contains Shanghai and Guangzhou; Taipei Xinyi and Kaohsiung; Sapporo and Yokohama; Seattle and Lower Manhattan. Each pair includes an urban waterfront.


## Scope and accuracy

There are **51 landmark assemblies**. The reviewed inventory covers major structures in the initial views and roughly 2–3 km around them, not every named attraction or historic building. Towers, cultural buildings, wheels and bridges receive original low-polygon silhouettes. Parks and ordinary streets remain map geometry. The Statue of Liberty lies beyond this inventory's radius.

[The catalog](../src/three/showcase-landmarks.json) records bilingual names, OSM identities, anchors, source heights, display heights, retrieval dates and replacement footprints. Attribution is © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). No reference photos or third-party meshes are bundled. Height bases distinguish existing reviewed references, OSM tags and approximate display values. Shapes, facade details, freeform surfaces, bridge structures and lighting remain artistic approximations rather than survey models.

Stepped towers are the easiest to extend. Historic roofs require more silhouette review. Freeform buildings such as MoPOP, Guangzhou Opera House and the cruise terminal need the most refinement for close views. Open lattices, wheel spokes and suspension cables consume the most geometry. See the [full inventory and evaluation](SHOWCASE.zh-TW.md).

## Measured capacity

Run `node scripts/measure-showcase.mjs [report.json]` to reproduce geometry counts and source/gzip sizes. The current 51 assemblies total **50,355 triangles and 9.221 MiB of vertex attributes** if all were generated together. They are geographically culled. The largest city group is Guangzhou at 15,408 triangles / 2.821 MiB.

The catalog, generators and selection/replacement module total about **179 KiB source / 24 KiB gzip**, excluding existing legacy definitions. These are source measurements, not the site's transfer size. There are no per-building GLB or texture downloads. Each view reserves up to **90,000 landmark vertices**, within the existing total facade budget. Complete assemblies are admitted atomically; an omitted model leaves its ordinary map building intact. Models share the existing facade mesh and draw call.

The current average suggests about 30 simultaneous assemblies, or 2–5 intricate lattice structures, within the geometry allocation. Larger catalogs need regional downloads and a spatial index before device testing. Only these 51 assemblies have been validated. Vertex figures exclude map resources, ordinary buildings, temporary CPU allocations and capture targets.

## Viewer and compatibility

**Settings → Landmark names** controls labels during exploration, including when controls are hidden. View links and scene files preserve this separately as `viewLabels`. Older scene files default to off. Capture's landmark-label option remains independent and controls exports and embed composition. Collision avoidance limits visible labels to nine in landscape and five in narrow portrait, prioritising tall special landmarks.

Showcase cameras are separate from the eight legacy snapshots. Retired city links and historical scene data remain readable. Ordinary buildings use the global service in every location; snapshots retain roads, railways and place labels. New regions have no bundled rail routes. Built-in landmark selection follows geography, so models also appear when navigating from search or another preset.
