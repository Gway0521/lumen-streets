# Save and share scenes

The 3D editor saves view files and shares camera links from **Capture**.

| Format | Includes | Limitations |
| --- | --- | --- |
| Scene file, `.lumen-view.json` | Camera, lighting, density, playback, simulation time, traffic and composition | Requires online tiles; does not embed map snapshots or imported GLBs |
| View link | Camera, lighting, density, playback, live landmark names, place name and language | Starts fresh traffic |
| Embed | View link with optional captions, landmark labels and shading | Requires online tiles; imported GLBs are not included |

Open **Scene files → Save scene** to download and **Open scene** to restore. Scene files stay in the browser; opening does not upload them. Traffic reconnects by stable road endpoints. If map data changes, unmatched vehicles restart; a file is not a permanent map revision or pixel-identical archive.

Copy the interface's embed code into a website. Embeds use the 3D page with `embed=1`. A localhost URL only works on that computer. Shared URLs and files disclose the selected location and settings.

**Settings → Landmark names** controls labels during exploration, including with hidden controls. View links and scene files preserve this as `viewLabels`. The label option in Capture controls exports and embed composition separately.

## Current file contract

The JSON envelope uses `format: "lumen-streets-view"`, `version: 1`. It contains `view`, `name`, `time`, `playing`, `aspect`, `composition`, optional `viewLabels` (boolean, defaults to false) and optional `traffic`. Imports are limited to 1.5 million bytes and 1600 cars, with bounded coordinates, camera values, text and composition. Imported models must be loaded separately.

See [3D architecture](ARCHITECTURE.md), [landmark contributions](3D-LANDMARKS.md) and the [scene sharing guide](https://lumenstreets.feifeihome.com/scenes.html) ([繁體中文](https://lumenstreets.feifeihome.com/scenes.html#zh)).

## Earlier 2D scenes

Existing `.lumen.json` files with `format: "lumen-streets-scene"` and `player.html#scene=…` links still open in the legacy read-only player. Hosted same-origin scene paths also remain supported there. The 3D editor cannot import or convert these files.

The legacy player retains the Canvas engine and its versioned building profiles so saved artwork can still be read. Its files embed attributed source snapshots and have a separate 40-million-byte limit. Keep the original file when moving to a new 3D composition.
