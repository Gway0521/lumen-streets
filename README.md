# <img src="public/favicon.svg" width="36" height="36" alt=""> Lumen Streets

**Explore a living world after dark.**

Lumen Streets turns OpenStreetMap streets and buildings into a navigable 3D nightscape. Choose a place, adjust the lighting, compose a view and export a wallpaper.

[**Public demo**](https://lumenstreets.feifeihome.com/) · [繁體中文](README.zh-TW.md) · [Wallpapers](docs/EXPORTS.md) · [Contributing](CONTRIBUTING.md)

![Sapporo in Lumen Streets](docs/images/social-cover.gif)

*Rendered in Lumen Streets. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) and [Overture Maps](https://docs.overturemaps.org/attribution/); height-source credits are listed in [Attribution](ATTRIBUTION.md).*

Read the [v0.3.0 release notes](docs/releases/v0.3.0.md).

## Make it your night

- **Explore beyond one neighbourhood.** Pan, rotate, tilt and zoom across global vector maps. Eight curated starting views pair city streets with waterfronts; existing snapshots add detail where available.
- **Buildings and light.** Varied architectural facades, restrained windows, street lamps, vegetation and stylized water reflections surround 51 modeled landmark assemblies. Toggle landmark names in Settings. See the [showcase inventory and capacity study](docs/SHOWCASE.md).
- **Frame a wallpaper.** PNG up to a 3840-pixel long edge, video up to 2560 pixels and a six-second GIF preview. Desktop, ultrawide, tablet, phone and custom ratios share titles, landmark labels and soft edge shading.
- **Return and share.** Save camera, composition and traffic in a scene file, share a view link, or copy an embed.
- **Contribute a landmark.** Preview a bounded local GLB and download its model, placement, license and preview as a contribution ZIP.

## Run locally

Install **Node.js 24** and **Python 3.12** with pip and venv, then:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5180/**. Use **Explore**, **Settings** and **Capture**. Drag to pan, right-drag to rotate and tilt, and scroll to zoom. English and Traditional Chinese are supported.

The first start installs the building-data worker's dependencies into a local Python environment. Visitors only need a browser with WebGL2 and online map access. See [browser compatibility](docs/COMPATIBILITY.md) and [map services](docs/PROVIDERS.md).

## Wallpapers and sharing

PNG creates a still wallpaper. Video selects MP4/AVC when supported and WebM/VP9 otherwise; choose 30 seconds to five minutes. GIF creates a six-second preview. Videos repeat with a cut. See [exports](docs/EXPORTS.md) and [scene files and embeds](docs/SCENES.md).

Earlier scene files remain readable through the legacy player. See [Scenes](docs/SCENES.md) for file compatibility.

## Self-hosting

```sh
npm run build
npm start
```

Stop the development server before starting production on port 5180. Node serves the website, search and global building tiles; Python workers improve heights in the background. See [Hosting](docs/HOSTING.md) for HTTPS, cache sizing and deployment archives.

MapLibre and Three.js share the live 3D scene with captures and embeds. Geometry runs in a worker with bounded tile caches and explicit GPU resource disposal. See [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md) and [Testing](docs/TESTING.md).

## License

Code: [AGPL-3.0-only](LICENSE). Map data: [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL. Preserve visible map credit when sharing exports publicly; see [Attribution](ATTRIBUTION.md).

Building heights combine mapped values and estimates. Lighting, vegetation placement and traffic are artistic simulations. Imported models stay local until their creator submits them for review. See the [landmark guide](docs/3D-LANDMARKS.md).

The [building service](docs/BUILDING-HEIGHTS.md) combines Overture footprints, GHS regional estimates and geographically matched PLATEAU/EUBUCCO data. Measurement coverage varies by location.
