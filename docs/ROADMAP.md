# Roadmap

The experimental 3D edition has its own [roadmap](3D-ROADMAP.md) and [繁體中文版](3D-ROADMAP.zh-TW.md). The items below concern the classic editor.

The editor, eight maps, wallpaper exports and scene sharing are implemented. Current work focuses on reliability and making the first visit feel effortless.

- **Demo reliability:** keep the [public demo](https://lumenstreets.feifeihome.com/) responsive and monitor map-provider capacity as traffic grows.
- **Device coverage:** test more physical phones, especially Safari and high-resolution video exports.
- **Dense maps:** reduce interruptions during parsing and atlas creation, and improve traffic behaviour at crowded junctions.
- **Map coverage:** improve missing landmark names and tricky road/rail geometry through shared rules.
- **Recognizable structures:** expand beyond the six reviewed Taipei/Sapporo/Shanghai landmarks, improve incomplete building-part coverage and inspect intersecting structures that need more than the current painter fallback.

Suggestions are welcome in issues. Priorities follow practical use cases, the [art direction](ART_DIRECTION.md) and a simple export flow.
