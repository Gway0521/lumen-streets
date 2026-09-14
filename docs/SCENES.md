# Save and share scenes

A scene file lets you return to a view or open it in another browser. Player links and embeds make bundled places easy to share.

## Choose a sharing format

| Format | Includes | Use it for |
| --- | --- | --- |
| Complete `.lumen.json` file | Map data, view, settings and the exact traffic state | Keeping a scene, sharing an imported place, moving between browsers |
| Player link | A bundled place, view and settings; traffic starts at eight seconds | Sharing a composition on a hosted site |
| Embed code | The same player link in an iframe | Displaying a bundled scene on another website |

Choose **Scene → Save & share scene → Download scene** to save a complete file. Open it with **Open scene file** in the editor or player. The recipient needs access to Lumen Streets; loading the file does not query a map provider.

Scene files include the selected location and map sources. Reduced-motion preferences may cause a saved playing scene to open paused. Use **Play** to start it.

Links use the website's address, so a localhost link only works on its own computer. Bundled-place links also check the map fingerprint. Keep a complete scene file if you want to retain the data independently of future preset updates.

## Embed an imported place

Save a complete scene as `scenes/kyoto.lumen.json` inside your hosted app directory, then embed it:

```html
<iframe src="./player.html?scene=scenes/kyoto.lumen.json"
  title="Lumen Streets" width="960" height="540" loading="lazy"
  style="border:0;width:100%;aspect-ratio:16/9;height:auto"></iframe>
```

When embedding from a different website, replace `./player.html` with the player's full HTTPS URL. The scene file must be on the player's own origin and inside its app directory.

The player keeps OpenStreetMap credit visible. It pauses when offscreen or hidden and resumes without jumping ahead through the hidden time. Each player has independent playback.

Both the Node server and static hosting can serve player pages and scene files. See [Hosting](HOSTING.md) and the [in-app sharing guide](../public/scenes.html).

## File format reference

The JSON envelope uses `format: "lumen-streets-scene"` and `version: 1`:

| Field | Contents |
| --- | --- |
| `license` | OpenStreetMap copyright URL |
| `source` | Place ID, region metadata and raw `mapText` / `railText` snapshots |
| `recipe` | Renderer version, camera, palette, appearance, density, trains, seed and simulation checkpoint |
| `view` | Logical viewport width and height |

Raw snapshot strings retain their byte-level fingerprints. Map data remains under ODbL; keep its source and licensing metadata.

New scenes use `aerial-8`. Saved `aerial-7` scenes retain their original oblique projection, building generator and night artwork. **Scene → Update scene style** explicitly converts a loaded older scene to the new orthographic view and current profiles while preserving its camera and traffic; the original file is unchanged. Readers still accept `aerial-1` through `aerial-6` with their existing migration to aerial-7. That earlier migration preserves settings and traffic, not the pixels of those older renderers.

Current recipes require `structures`: a pack identifier, generator/projection versions, camera elevation and used declarative profiles with replacement scopes. Complete files embed these definitions. Compact links may refer to unchanged bundled profiles by ID and SHA-256 pack hash; decoding restores only that exact published pack without a network request. Customized definitions remain embedded when small enough; larger scenes can still be shared as complete files. Unknown versions, mismatched hashes and malformed profiles are rejected before rendering. Keep archived pack and generator implementations when publishing successors. Imported profiles are bounded data, not executable models or trusted source assertions. See [Buildings](BUILDINGS.md). Pixel equality is tested within the same browser; different browsers can rasterize edges differently.

Files are limited to 40 million bytes, with 16 million bytes per source snapshot and 32 JSON nesting levels. Viewport dimensions must be 128–8192 pixels; the player caps its drawing surface at 8 million pixels and 4096 per dimension. Map extents and geometry are validated before creating a replacement scene.

Hosted files require a same-origin `.lumen.json` path and have a 30-second load deadline. Redirects, paths outside the app, incompatible fingerprints and unsupported versions are rejected. Source URLs inside files are metadata and are never fetched. Hashes detect data changes, not source authenticity.

Compact references are limited to 6000 base64url characters and 4500 decoded JSON bytes. They live in the URL fragment and omit the full simulation checkpoint.

See [Architecture](ARCHITECTURE.md) for engine ownership and [Testing](TESTING.md) for file and player checks.
