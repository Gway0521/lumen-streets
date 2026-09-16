import snapshots from "../regions.json" with { type: "json" };

// Showcase cameras are independent of the immutable legacy snapshot registry.
// Old city links and saved scenes remain readable, but only these eight appear in Explore.
export const presets = {
  shanghai: {
    group: "china",
    names: ["Shanghai · Huangpu", "上海・黃浦江"],
    center: [121.495, 31.239],
    zoom: 14.7,
    bearing: -14,
    waterfront: true,
  },
  guangzhou: {
    group: "china",
    names: ["Guangzhou · Pearl River", "廣州・珠江新城"],
    center: [113.32, 23.115],
    zoom: 14.75,
    bearing: -16,
    waterfront: true,
  },
  xinyi: {
    group: "taiwan",
    names: ["Taipei · Xinyi", "台北・信義"],
    center: [121.5638, 25.0368],
    zoom: 14.6,
    bearing: -10,
    waterfront: false,
  },
  kaohsiung: {
    group: "taiwan",
    names: ["Kaohsiung · Love River Bay", "高雄・愛河灣"],
    center: [120.296, 22.614],
    zoom: 14.85,
    bearing: -20,
    waterfront: true,
  },
  sapporo: {
    group: "japan",
    names: ["Sapporo · Odori", "札幌・大通"],
    center: [141.3545, 43.063],
    zoom: 14.8,
    bearing: 0,
    waterfront: false,
  },
  yokohama: {
    group: "japan",
    names: ["Yokohama · Minato Mirai", "橫濱・港未來"],
    center: [139.6365, 35.454],
    zoom: 14.75,
    bearing: -24,
    waterfront: true,
  },
  seattle: {
    group: "usa",
    names: ["Seattle · Elliott Bay", "西雅圖・艾略特灣"],
    center: [-122.34, 47.612],
    zoom: 14.4,
    bearing: 20,
    waterfront: true,
  },
  newyork: {
    group: "usa",
    names: ["New York · Lower Manhattan", "紐約・下曼哈頓"],
    center: [-74.008, 40.709],
    zoom: 14.65,
    bearing: 15,
    waterfront: true,
  },
};
export const viewRegions = { ...snapshots, ...presets };
export function presetCamera(id, mobile = false) {
  const p = Object.hasOwn(viewRegions, id) ? viewRegions[id] : presets.shanghai;
  return {
    center: p.center,
    zoom: (p.zoom || 14.5) - (mobile ? 0.65 : 0),
    bearing: p.bearing || 0,
    pitch: 45,
  };
}
