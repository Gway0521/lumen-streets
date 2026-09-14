const zoom = (...stops) => [
  "interpolate",
  ["exponential", 2],
  ["zoom"],
  ...stops,
];
const roadClass = ["get", "class"];
const mainRoad = [
  "match",
  roadClass,
  ["motorway", "trunk", "primary"],
  1,
  ["secondary", "tertiary"],
  0.68,
  ["path", "track"],
  0.08,
  0.24,
];
export function nightStyle(tileURL = "https://tiles.openfreemap.org/planet") {
  return {
    version: 8,
    sources: {
      world: {
        type: "vector",
        url: tileURL,
        maxzoom: 14,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org/">OpenFreeMap</a>',
      },
    },
    layers: [
      {
        id: "night",
        type: "background",
        paint: { "background-color": "#0c171e" },
      },
      {
        id: "land",
        type: "fill",
        source: "world",
        "source-layer": "landcover",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["wood", "grass"],
            "#0b1c1c",
            "#101c23",
          ],
          "fill-opacity": 0.85,
        },
      },
      {
        id: "districts",
        type: "fill",
        source: "world",
        "source-layer": "landuse",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["commercial", "retail"],
            "#1c2329",
            ["industrial"],
            "#111b23",
            "#111d23",
          ],
          "fill-opacity": 0.8,
        },
      },
      {
        id: "parks",
        type: "fill",
        source: "world",
        "source-layer": "park",
        paint: { "fill-color": "#091c1c", "fill-opacity": 0.95 },
      },
      {
        id: "water",
        type: "fill",
        source: "world",
        "source-layer": "water",
        paint: { "fill-color": "#07141e" },
      },
      {
        id: "waterways",
        type: "line",
        source: "world",
        "source-layer": "waterway",
        paint: { "line-color": "#07141e", "line-width": zoom(10, 1, 16, 10) },
      },
      {
        id: "footprints",
        type: "fill",
        source: "world",
        "source-layer": "building",
        minzoom: 12,
        paint: {
          "fill-color": "#23313a",
          "fill-opacity": zoom(12, 0.15, 14, 0.7, 16, 0.6),
        },
      },
      ...[
        ["road-halo", 4.6, "#ce964d", 0.2, 5],
        ["road-glow", 2.1, "#d8ad6a", 0.36, 2.8],
        ["road-rim", 1, "#dcc38a", 0.72, 0.65],
        ["road-asphalt", 0.5, "#303136", 0.83, 0.3],
      ].map(([id, mult, color, opacity, blur]) => ({
        id,
        type: "line",
        source: "world",
        "source-layer": "transportation",
        filter: [
          "all",
          [
            "match",
            roadClass,
            [
              "motorway",
              "trunk",
              "primary",
              "secondary",
              "tertiary",
              "minor",
              "service",
              "residential",
              "path",
              "track",
              "street",
            ],
            true,
            false,
          ],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": color,
          "line-width": zoom(
            5,
            ["*", 0.3, mainRoad, mult],
            12,
            ["*", 1.4, mainRoad, mult],
            15,
            ["*", 6, mainRoad, mult],
            17,
            ["*", 24, mainRoad, mult],
          ),
          "line-opacity": opacity,
          "line-blur": blur,
        },
      })),
      {
        id: "railways",
        type: "line",
        source: "world",
        "source-layer": "transportation",
        filter: [
          "all",
          ["==", roadClass, "rail"],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        paint: {
          "line-color": "#536772",
          "line-width": zoom(12, 0.3, 16, 1.2),
          "line-opacity": 0.5,
        },
      },
      {
        id: "building-fallback",
        type: "fill-extrusion",
        source: "world",
        "source-layer": "building",
        minzoom: 14.1,
        paint: {
          "fill-extrusion-color": "#26343c",
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14.1,
            0,
            14.8,
            ["coalesce", ["get", "render_height"], 8],
          ],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 1,
        },
      },
    ],
    light: {
      anchor: "viewport",
      color: "#a7bfd0",
      intensity: 0.22,
      position: [1.5, 190, 45],
    },
  };
}
