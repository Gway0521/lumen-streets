import { VIEW } from "./view.js";
// Shared with the light control so returning to 100% restores the art baseline.
export const ROAD_LIGHT = Object.freeze({
  "road-halo": 0.065,
  "road-glow": 0.2,
  "road-rim": 0.56,
});
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
        paint: { "background-color": "#101e2b" },
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
            "#141e24",
            ["industrial"],
            "#111b23",
            "#0d171d",
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
        paint: { "fill-color": "#0a2032" },
      },
      {
        id: "waterways",
        type: "line",
        source: "world",
        "source-layer": "waterway",
        paint: { "line-color": "#0a2032", "line-width": zoom(10, 1, 16, 10) },
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
        ["road-halo", 4.5, "#af8259", ROAD_LIGHT["road-halo"], 4],
        ["road-glow", 2.0, "#d8af7e", ROAD_LIGHT["road-glow"], 1.4],
        ["road-rim", 1.05, "#e4c59b", ROAD_LIGHT["road-rim"], 0.3],
        ["road-asphalt", 0.68, "#172029", 0.94, 0.12],
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
            ["*", 2.0, mainRoad, mult],
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
        minzoom: VIEW.atlas,
        paint: {
          "fill-extrusion-color": "#26343c",
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            VIEW.atlas,
            0,
            VIEW.fullHeight,
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
