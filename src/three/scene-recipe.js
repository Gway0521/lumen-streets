// @ts-check
import { viewRecipe } from "./geo.js";

const edgeKey = (e) => `${e.from.id}|${e.to.id}`;
/** @returns {import("./contracts.ts").TrafficRecipe | null} */
export function trafficRecipe(traffic) {
  if (!traffic) return null;
  const snapshot = traffic.snapshot();
  return {
    ...snapshot,
    cars: snapshot.cars.map((c) => ({
      ...c,
      edge: edgeKey(traffic.graph.edges[c.edge]),
      next: c.next === null ? null : edgeKey(traffic.graph.edges[c.next]),
    })),
  };
}
/** @param {import("./contracts.ts").TrafficRecipe | null} recipe */
export function restoreTraffic(traffic, recipe) {
  if (!traffic || !recipe) return false;
  const edges = new Map(traffic.graph.edges.map((e) => [edgeKey(e), e]));
  const cars = recipe.cars.flatMap((c) => {
    const edge = edges.get(c.edge),
      next = c.next === null ? null : edges.get(c.next);
    return edge &&
      c.s <= edge.length &&
      (c.next === null || next?.from === edge.to)
      ? [{ ...c, edge: edge.id, next: next?.id ?? null }]
      : [];
  });
  traffic.restore({ ...recipe, cars });
  return cars.length === recipe.cars.length;
}
/** @returns {import("./contracts.ts").SceneRecipe} */
export function validateScene(value) {
  const fail = () => {
    throw Error("Invalid Lumen Streets scene");
  };
  const finite = (n, a, b) =>
    typeof n === "number" && Number.isFinite(n) && n >= a && n <= b;
  const text = (s, max) =>
    typeof s === "string" &&
    s.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(s);
  if (
    value?.format !== "lumen-streets-view" ||
    value.version !== 1 ||
    !value.view ||
    !finite(value.time, 0, 1e9) ||
    typeof value.playing !== "boolean"
  )
    fail();
  if (value.viewLabels !== undefined && typeof value.viewLabels !== "boolean")
    fail();
  const v = value.view;
  for (const [key, a, b] of [
    ["lng", -180, 180],
    ["lat", -80, 80],
    ["zoom", 2, 18],
    ["pitch", 0, 55],
    ["bearing", -360, 360],
    ["glow", 0.4, 1.6],
    ["density", 0, 1600],
  ])
    if (!finite(v[key], a, b)) fail();
  const c = value.composition || {},
    q = c.quiet || { edge: "none", brightness: 45, area: 60 };
  if (
    !["none", "left", "right", "top", "bottom"].includes(q.edge) ||
    !finite(q.brightness, 0, 100) ||
    !finite(q.area, 1, 100)
  )
    fail();
  let title;
  if (c.placeTitle) {
    const t = c.placeTitle;
    if (
      !text(t.text, 120) ||
      !["top-left", "top-right", "bottom-left", "bottom-right"].includes(
        t.corner,
      ) ||
      !["small", "medium", "large"].includes(t.size)
    )
      fail();
    title = { text: t.text, corner: t.corner, size: t.size };
  }
  if (!finite(value.aspect, 0.25, 4) || !text(value.name || "", 120)) fail();
  let traffic = null;
  if (value.traffic) {
    const r = value.traffic;
    if (
      !finite(r.time, 0, 1e9) ||
      !Number.isInteger(r.serial) ||
      r.serial < 0 ||
      !Number.isInteger(r.randomState) ||
      !Array.isArray(r.cars) ||
      r.cars.length > 1600
    )
      fail();
    const ids = new Set();
    const cars = r.cars.map((c) => {
      if (
        !Number.isInteger(c.id) ||
        c.id < 0 ||
        ids.has(c.id) ||
        !text(c.edge, 200) ||
        (c.next !== null && !text(c.next, 200)) ||
        typeof c.bus !== "boolean"
      )
        fail();
      ids.add(c.id);
      for (const [key, max] of [
        ["s", 1e6],
        ["speed", 100],
        ["maxSpeed", 100],
        ["length", 30],
        ["age", 1e9],
        ["stopped", 1e9],
      ])
        if (!finite(c[key], 0, max)) fail();
      return {
        id: c.id,
        edge: c.edge,
        next: c.next,
        s: c.s,
        speed: c.speed,
        maxSpeed: c.maxSpeed,
        length: c.length,
        bus: c.bus,
        age: c.age,
        stopped: c.stopped,
      };
    });
    traffic = {
      time: r.time,
      serial: r.serial,
      randomState: r.randomState,
      cars,
    };
  }
  return {
    format: "lumen-streets-view",
    version: 1,
    view: viewRecipe(v),
    name: value.name || "",
    time: value.time,
    playing: value.playing,
    viewLabels: value.viewLabels === true,
    aspect: value.aspect,
    composition: {
      quiet: { edge: q.edge, brightness: q.brightness, area: q.area },
      placeTitle: title,
      landmarkLabels: c.landmarkLabels === true,
      locale: c.locale === "zh-TW" ? "zh-TW" : "en",
    },
    traffic,
  };
}
