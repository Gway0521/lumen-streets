# <img src="public/favicon.svg" width="36" height="36" alt=""> Lumen Streets

**Explore a living world after dark.**

Lumen Streets turns OpenStreetMap streets and buildings into a navigable 3D nightscape. Choose a place, adjust the lighting, compose a view and export a wallpaper.

[**Public demo**](https://lumenstreets.feifeihome.com/) · [繁體中文](README.zh-TW.md) · [Wallpapers](docs/EXPORTS.md) · [Contributing](CONTRIBUTING.md)

**Development version: 0.3.0-dev.0.** The 3D editor is the main experience in this checkout. The [v0.3.0 notes](docs/releases/v0.3.0.md) describe work in progress; the public demo may run a different version.

## Make it your night

- **Explore beyond one neighbourhood.** Pan, rotate, tilt and zoom across global vector maps. Eight curated starting views pair city streets with waterfronts; existing snapshots add detail where available.
- **Buildings and light.** Varied architectural facades, restrained windows, street lamps, vegetation and stylized water reflections surround 51 modeled landmark assemblies. Toggle landmark names in Settings. See the [showcase inventory and capacity study](docs/SHOWCASE.md).
- **Frame a wallpaper.** PNG up to a 3840-pixel long edge, video up to 2560 pixels and a six-second GIF preview. Desktop, ultrawide, tablet, phone and custom ratios share titles, landmark labels and soft edge shading.
- **Return and share.** Save camera, composition and traffic in a scene file, share a view link, or copy an embed.
- **Contribute a landmark.** Preview a bounded local GLB and download its model, placement, license and preview as a contribution ZIP.

## Run locally

Install Node.js 24, then:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5180/**. Use **Explore**, **Settings** and **Capture**. Drag to pan, right-drag to rotate and tilt, and scroll to zoom. English and Traditional Chinese are supported.

The 3D renderer requires WebGL2 and online vector tiles, including at preset locations. Search uses the included Node gateway. See [browser compatibility](docs/COMPATIBILITY.md) and [map services](docs/PROVIDERS.md).

## Wallpapers and sharing

PNG creates a still wallpaper. Video selects MP4/AVC when supported and WebM/VP9 otherwise; choose 30 seconds to five minutes. GIF creates a six-second preview. Videos repeat with a cut. See [exports](docs/EXPORTS.md) and [scene files and embeds](docs/SCENES.md).

The 3D editor uses a new scene format. Existing 2D files and player links remain readable through the legacy player; they do not migrate into 3D. The 2D editor is no longer an entry point. Amber/Blue hour palettes, the old study export and offline preset rendering are not features of the new editor.

## Self-hosting

```sh
npm run build
npm start
```

Stop the development server before starting production on port 5180. The Node server serves the site and search together. Static hosting supports rendering and exports with online tiles but no search gateway. See [Hosting](docs/HOSTING.md).

MapLibre and Three.js share the live 3D scene with captures and embeds. Geometry runs in a worker with bounded tile caches and explicit GPU resource disposal. See [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md) and [Testing](docs/TESTING.md).

## Earlier artwork

![v0.2.0 Sapporo nightscape](docs/images/social-cover.gif)

*Archived v0.2.0 Canvas artwork, not the current 3D renderer. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. The existing [gallery](public/gallery.html) and social preview also show v0.2.0 exports.*

## License

Code: [AGPL-3.0-only](LICENSE). Map data: [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL. Preserve visible map credit when sharing exports publicly; see [Attribution](ATTRIBUTION.md).

Building heights combine mapped values and estimates. Lighting, vegetation placement and traffic are artistic simulations. Imported models stay local until their creator submits them for review. See the [landmark guide](docs/3D-LANDMARKS.md).

Optional [building-height preprocessing](docs/BUILDING-HEIGHTS.md) combines Overture with regional sources, preserves missing values and provenance, and serves nearby building tiles. The tools are included; a hosted global enriched dataset is not bundled.
