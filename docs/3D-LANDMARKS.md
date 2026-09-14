# Bring a landmark

[繁體中文](3D-LANDMARKS.zh-TW.md) · [3D overview](3D-ARCHITECTURE.md)

The preview accepts a local GLB and a placement manifest. It does not upload files, publish a model, replace a community registry entry or automatically remove an underlying OSM building. Imported models are overlays for visual review. The six bundled landmarks have a separate source-aware replacement plan inherited from the original renderer.

## Prepare the model

Create an original, low-poly silhouette that reads from above. Spend geometry on the roofline, setbacks, visible openings and distinctive structures. Avoid tiny interior details. Use a small number of materials with restrained warm accents; streets should remain the brightest continuous feature.

Export **glTF 2.0 binary (`.glb`)**, Y up, in a single scene. Apply object transforms. The importer centres the model horizontally, places its lowest point at ground level, and scales it to the requested height. The rotation control turns it about vertical; review its north-facing orientation on the map.

| Limit | Current value |
| --- | --- |
| File size | 8 MiB |
| Triangles across scene instances | 20,000 |
| Vertices across scene instances | 60,000 |
| Nodes | 256 |
| Meshes / materials | 128 / 64 |
| Buffers | One embedded binary buffer |
| Geometry | Static triangles |
| Textures, animation, skins, compression, extensions | Not accepted in this preview |

Use material base colours. Imported materials are rendered unlit to remain predictable in the night palette. Texture atlases and emissive channels require a later curated material pipeline. No external resources are fetched by the importer. Malformed chunks, accessor bounds, circular hierarchies and amplified geometry counts are rejected before rendering.

## Preview and save

1. Open Landmarks and choose the GLB.
2. Enter the model creator, license, height in metres and rotation.
3. Position the camera centre where the building belongs, then choose **Place at map centre**.
4. Orbit and zoom to check the silhouette. Use **Remove model** to release it.
5. Choose **Save placement manifest**. Keep the original GLB beside the resulting `landmark.json`.

The manifest contains a version, filename, SHA-256, longitude/latitude anchor, height, bearing, creator, license and triangle count. Filenames and creator text are metadata, never executable code. A future registry must verify the file's content hash and license independently; checking a license field does not establish ownership.

Share or embed links do not carry GLB bytes. The model survives only for the current page session. PNG/GIF/video capture does include a currently placed model; retain its creator/license credit when distributing those exports.

## Future submission workflow

The planned reusable unit is a versioned model package: model, geospatial manifest, attribution and preview images. A public service will need upload storage, file validation outside the renderer, moderation, durable content-addressed URLs, an attribution manifest, spatial indexing, explicit OSM replacement rules, and downloadable levels of detail. None of these hosted features is implemented by the local import button.

Public submissions should include the source of measured height and a clear license for the model. Do not import proprietary map-provider meshes or redistribute third-party models without permission. Model updates should preserve prior content hashes so saved scenes can select an earlier revision.
