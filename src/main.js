import { t, locale, placeName, applyLocale, setLocale } from "./i18n.js";
import { regions } from "./city.js";
import { loadSceneData } from "./scene/data.ts";
import { createRecipe } from "./scene/recipe.ts";
import { SceneEngine } from "./engine/scene-engine.ts";
import { screenToWorld, inversePoint } from './engine/projection.js';
import { createExportUI } from "./export/ui.js";
import { createSceneUI } from "./scene/ui.js";
import { SceneFileError } from "./scene/portable.ts";
import { DEFAULT_APPEARANCE } from "./scene/appearance.ts";
import { mapErrorText } from "./search/errors.js";
import "./style.css";
const $ = (id) => document.getElementById(id),
  canvas = $("city"),
  ctx = canvas.getContext("2d", { alpha: false });
let city,
  engine,
  width = 0,
  height = 0,
  dpr = 1,
  mood = ["blue", "amber", "aerial"].includes(
    new URLSearchParams(location.search).get("mood"),
  )
    ? new URLSearchParams(location.search).get("mood")
    : "aerial",
  trains = true,
  xray = false,
  playing = !matchMedia("(prefers-reduced-motion: reduce)").matches,
  density = 80,
  appearance = { ...DEFAULT_APPEARANCE },
  busy = false,
  quietMode = false,
  animation = 0,
  interactionFrame = 0,
  pageVisible = !document.hidden,
  last = 0;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const moodName = (id) => t(id);
applyLocale();
document
  .querySelectorAll("[data-mood]")
  .forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.mood === mood)),
  );
const cities = new Map(),
  pointers = new Map();
for (const [id, region] of Object.entries(regions)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = placeName({ ...region, id });
  $("place-select").append(option);
}
function origin() {
  return [width * (width > 760 && !quietMode ? 0.63 : 0.5), height * 0.5];
}
function defaultZoom() {
  return (
    (Math.max(width * 0.7, height) / (city.bounds[2] - city.bounds[0])) * 1.18
  );
}
function reset() {
  if (!engine) return;
  engine.setCamera({ x: 0, y: 0, zoom: defaultZoom() });
  draw();
}
function worldAt(x, y) {
  const camera = engine.camera;
  const o = origin();
  return screenToWorld([x,y],camera,o,engine.projection);
}
function zoom(factor, x = width * 0.6, y = height * 0.5, deferred = false) {
  if (!city) return;
  const old = worldAt(x, y),
    camera = engine.camera;
  camera.zoom = Math.max(
    Math.min(
      defaultZoom() * 0.65,
      ((width - 30) / (city.bounds[2] - city.bounds[0])) * 0.8,
    ),
    Math.min(3.5, camera.zoom * factor),
  );
  engine.setCamera(camera);
  const fresh = worldAt(x, y);
  camera.x += old[0] - fresh[0];
  camera.y += old[1] - fresh[1];
  engine.setCamera(camera);
  clampCamera();
  if (deferred) requestInteractionDraw(); else draw();
}
function clampCamera() {
  if (!city) return;
  const b = city.bounds,
    camera = engine.camera;
  camera.x = Math.max(b[0] + 100, Math.min(b[2] - 100, camera.x));
  camera.y = Math.max(b[1] + 100, Math.min(b[3] - 100, camera.y));
  engine.setCamera(camera);
}
function draw() {
  cancelAnimationFrame(interactionFrame); interactionFrame = 0;
  if (!engine || !pageVisible) return;
  engine.render(ctx, { width, height, dpr, quietMode, locale });
}
// Pointer events can outpace the display, especially with two fingers. Keep
// every camera update, but share one paint with playback in the next frame.
function requestInteractionDraw() {
  if (!interactionFrame && pageVisible) interactionFrame = requestAnimationFrame(draw);
}
function resize() {
  width = innerWidth;
  height = $("app").clientHeight;
  dpr = Math.min(devicePixelRatio, 1.8, 4096 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (city) draw();
}
addEventListener("resize", resize);
resize();
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 3500);
}
let loadController, retryLoad;
async function loadScene(loader) {
  loadController?.abort();
  const controller = new AbortController(); loadController = controller;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  retryLoad = loader;
  busy = !engine;
  $("loading").hidden = !!engine;
  $("map-load").hidden = !engine;
  $("retry-map").hidden = $("adjust-area").hidden = true;
  $("cancel-map").textContent = t("cancel");
  const progress = stage => { if (loadController === controller) $("map-load-message").textContent = t(stage); };
  progress("loadingMap");
  try {
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    const loaded = await loader(controller.signal, progress);
    const next = loaded.data ?? loaded;
    controller.signal.throwIfAborted();
    const recipe = loaded.recipe ?? createRecipe(next);
    if (!loaded.recipe) Object.assign(recipe, {
      palette: mood,
      density,
      trains,
      underground: xray,
      playing,
      appearance,
    });
    let nextEngine;
    try { nextEngine = new SceneEngine(next, recipe); }
    catch (error) { if (loaded.recipe) throw new SceneFileError(); throw error; }
    exportUI.cancel();
    sceneUI.close();
    engine?.dispose();
    engine = nextEngine;
    city = next.geometry;
    appearance = engine.snapshot().appearance;
    syncAppearance();
    if (loaded.recipe) {
      mood = recipe.palette; density = recipe.density; trains = recipe.trains; xray = recipe.underground; playing = recipe.playing;
      syncAppearance();
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) playing = false;
      engine.playing = playing;
      $("density").value = density; $("density-label").textContent = t(density < 25 ? "low" : density < 75 ? "medium" : "high");
      $("trains").setAttribute("aria-pressed", String(trains)); $("underground").setAttribute("aria-pressed", String(xray));
      document.querySelectorAll("[data-mood]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mood === mood))); syncPlaying();
    }
    for (const option of [...$("place-select").options]) if (!Object.hasOwn(regions, option.value)) option.remove();
    if (!Object.hasOwn(regions, next.id)) {
      const option = document.createElement("option"); option.value = next.id; option.textContent = placeName(city); $("place-select").append(option);
    }
    history.replaceState(null, "", Object.hasOwn(regions, next.id) ? "#" + next.id : location.pathname + location.search);
    $("map-load").hidden = true;
    refreshSceneText();
    if (loaded.recipe) draw(); else reset();
    if (city.railUnavailable) toast(t("railError"));
  } catch (error) {
    if (loadController !== controller) return;
    if (city) $("place-select").value = city.id;
    if (controller.signal.aborted && !timedOut) $("map-load").hidden = true;
    else {
      $("map-load").hidden = false;
      $("map-load-message").textContent = timedOut ? t("sceneCancelled") : error instanceof SceneFileError ? t(error.code) : mapErrorText(error);
      $("retry-map").hidden = false;
      $("adjust-area").hidden = $("find-place").hidden;
      $("cancel-map").textContent = t("close");
    }
  } finally {
    clearTimeout(deadline);
    if (loadController === controller) { busy = false; $("loading").hidden = true; loadController = undefined; }
    schedule();
  }
}
function select(id) {
  if (city?.id === id) { loadController?.abort(); $("map-load").hidden = true; return; }
  return loadScene(async signal => {
    let next = [...cities.values()].find(data => data.id === id);
    if (!next) {
      next = await loadSceneData(id, signal); signal.throwIfAborted();
      if (cities.size >= 2) cities.delete(cities.keys().next().value);
      cities.set(next.fingerprint, next);
    }
    return next;
  });
}
$("cancel-map").onclick = () => { loadController?.abort(); $("map-load").hidden = true; };
$("retry-map").onclick = () => retryLoad && loadScene(retryLoad);
$("adjust-area").onclick = () => { $("map-load").hidden = true; $("find-place").click(); };
fetch(`${import.meta.env.BASE_URL}api/capabilities`).then(r => r.ok ? r.json() : null).then(async config => {
  if (!config?.search) return;
  $("find-place").hidden = false;
  $("find-place").onclick = async () => {
    $("find-place").disabled = true;
    try {
      const { initSearch } = await import("./search/ui.js");
      initSearch(loadScene); $("find-place").disabled = false; $("find-place").click();
    } catch { toast(t("unavailable")); }
    finally { $("find-place").disabled = false; }
  };
}).catch(() => {});
function refreshSceneText() {
  if (!city) return;
  $("eyebrow").textContent = city.english;
  $("place-select").value = city.id;
  canvas.setAttribute("aria-label", t("canvas", { name: placeName(city) }));
  $("status").textContent =
    placeName(city) + " · " + t(playing ? "playing" : "paused");
  const dimensions = {
    width: ((city.bounds[2] - city.bounds[0]) / 1000).toFixed(1),
    height: ((city.bounds[3] - city.bounds[1]) / 1000).toFixed(1),
    count: city.buildings.length.toLocaleString(locale),
  };
  $("data-info").textContent = t("data", dimensions);
  $("place-size").textContent = t("size", dimensions);
  $("source-info").textContent = t("sourceDate", { date: new Date(engine.data.source.map.retrievedAt).toLocaleDateString(locale) });
  syncRailInfo();
}
$("place-select").onchange = (event) => select(event.target.value);
addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (Object.hasOwn(regions, id)) select(id);
});
document.querySelectorAll("[data-mood]").forEach(
  (b) =>
    (b.onclick = async () => {
      if (busy || mood === b.dataset.mood || !city) return;
      try { engine.setPalette(b.dataset.mood); }
      catch { toast(t("paletteFailed")); return; }
      mood = b.dataset.mood;
      syncAppearance();
      const url = new URL(location.href);
      url.searchParams.set("mood", mood);
      history.replaceState(null, "", url);
      document
        .querySelectorAll("[data-mood]")
        .forEach((v) =>
          v.setAttribute("aria-pressed", v.dataset.mood === mood),
        );
      draw();
    }),
);
$("trains").onclick = () => {
  trains = !trains;
  engine?.setRail(trains, xray);
  $("trains").setAttribute("aria-pressed", String(trains));
  draw();
};
function syncRailInfo() {
  $("rail-info").textContent = city?.railUnavailable
    ? t("railError")
    : t(xray ? "railXray" : "railSurface");
}
$("underground").onclick = () => {
  xray = !xray;
  engine?.setRail(trains, xray);
  $("underground").setAttribute("aria-pressed", String(xray));
  syncRailInfo();
  draw();
};
function syncPlaying() {
  $("play").textContent = t(playing ? "pause" : "resume");
  $("play").setAttribute("aria-pressed", String(playing));
  if (city) $("status").textContent = placeName(city) + " · " + t(playing ? "playing" : "paused");
  schedule();
}
syncPlaying();
$("play").onclick = () => {
  playing = !playing;
  if (engine) engine.playing = playing;
  syncPlaying();
};
$("density").oninput = (e) => {
  density = Number(e.target.value);
  $("density-label").textContent = t(
    density < 25 ? "low" : density < 75 ? "medium" : "high",
  );
  engine?.setDensity(density);
  draw();
};
$("reset").onclick = reset;
$("fit").onclick = () => {
  if (!city) return;
  const camera = engine.camera;
  camera.x = (city.bounds[0] + city.bounds[2]) / 2;
  camera.y = (city.bounds[1] + city.bounds[3]) / 2;
  camera.zoom = Math.min(
    (width * (width > 760 ? 0.68 : 0.92)) / (city.bounds[2] - city.bounds[0]),
    (height * 0.8) / (city.bounds[3] - city.bounds[1]),
  );
  engine.setCamera(camera);
  draw();
};
canvas.addEventListener("keydown", (e) => {
  if (!city) return;
  const directions = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (directions[e.key]) {
    e.preventDefault();
    const camera = engine.camera;
    const delta=inversePoint(directions[e.key],engine.projection);
    camera.x += delta[0]*60/camera.zoom;
    camera.y += delta[1]*60/camera.zoom;
    engine.setCamera(camera);
    clampCamera();
    draw();
  } else if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    zoom(1.25);
  } else if (e.key === "-") {
    e.preventDefault();
    zoom(0.8);
  }
});
$("zoom-in").onclick = () => zoom(1.3);
$("zoom-out").onclick = () => zoom(1 / 1.3);
function quiet(enabled) {
  if (enabled) { $('adjust-panel').hidden = true; $('adjust').setAttribute('aria-expanded','false'); }
  quietMode = enabled;
  $("app").classList.toggle("quiet", enabled);
  $("leave-quiet").hidden = !enabled;
  document
    .querySelectorAll("header,aside,.map-tools")
    .forEach((n) => (n.inert = enabled));
  (enabled ? $("leave-quiet") : $("quiet")).focus();
  draw();
}
$("quiet").onclick = () => quiet(true);
$("leave-quiet").onclick = () => quiet(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && quietMode) quiet(false);
});
$("about").onclick = () => $("notes").showModal();
$("close-notes").onclick = () => $("notes").close();
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.001), e.offsetX, e.offsetY, true);
  },
  { passive: false },
);
canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!engine || !pointers.has(e.pointerId)) return;
  const old = pointers.get(e.pointerId),
    others = [...pointers].filter(([id]) => id !== e.pointerId);
  if (others.length) {
    const p = others[0][1],
      before = Math.hypot(old[0] - p[0], old[1] - p[1]),
      after = Math.hypot(e.clientX - p[0], e.clientY - p[1]);
    if (before > 10)
      zoom(after / before, (p[0] + e.clientX) / 2, (p[1] + e.clientY) / 2, true);
  } else {
    const camera = engine.camera;
    const delta=inversePoint([e.clientX-old[0],e.clientY-old[1]],engine.projection);
    camera.x -= delta[0] / camera.zoom;
    camera.y -= delta[1] / camera.zoom;
    engine.setCamera(camera);
    clampCamera();
    requestInteractionDraw();
  }
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(name, (e) => pointers.delete(e.pointerId));
const exportUI = createExportUI(() => engine && !busy ? {
  engine, view: { width, height, dpr, quietMode, locale }, name: placeName(city), palette: mood,
} : null, toast);
const sceneUI = createSceneUI(() => engine && !busy ? { engine, view: { width, height } } : null, loadScene, toast);
function savePNG(mode) { return exportUI.savePNG(mode); }
$("save-study").onclick = () => savePNG("study");
function syncAppearance() {
  for (const key of ['brightness','glow','district']) {
    $(key).value = Math.round(appearance[key] * 100);
    $(`${key}-value`).textContent = `${Math.round(appearance[key] * 100)}%`;
  }
  $('landmark-labels').checked = appearance.labels;
  $('glow').disabled = $('district').disabled = mood !== 'aerial';
}
function applyAppearance(next) {
  try { engine?.setAppearance(next); appearance = next; draw(); }
  catch { toast(t('paletteFailed')); }
  syncAppearance();
}
for (const key of ['brightness','glow','district']) {
  $(key).oninput = () => { $(`${key}-value`).textContent = `${$(key).value}%`; if (key === 'brightness') applyAppearance({ ...appearance, brightness: Number($(key).value)/100 }); };
  // Expensive static lighting rebuilds only on release/keyboard commit.
  $(key).onchange = () => applyAppearance({ ...appearance, [key]: Number($(key).value)/100 });
}
$('landmark-labels').onchange = () => applyAppearance({ ...appearance, labels: $('landmark-labels').checked });
function adjust(open) {
  $('adjust-panel').hidden = !open; $('adjust').setAttribute('aria-expanded', String(open));
  if (open) { $('scene-menu').open = false; $('close-adjust').focus(); }
  else $('adjust').focus();
}
$('adjust').onclick = () => adjust($('adjust-panel').hidden);
$('close-adjust').onclick = () => adjust(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('adjust-panel').hidden && !document.querySelector('dialog[open]')) adjust(false); });
$('reset-adjustments').onclick = () => {
  applyAppearance({ ...DEFAULT_APPEARANCE });
  density = 80; trains = true; xray = false; engine?.setDensity(density); engine?.setRail(trains,xray);
  $('density').value = density; $('density-label').textContent = t('high');
  $('trains').setAttribute('aria-pressed','true'); $('underground').setAttribute('aria-pressed','false'); syncRailInfo(); draw();
};
$("language").onclick = () => {
  exportUI.cancel();
  sceneUI.close();
  setLocale(locale === "en" ? "zh-TW" : "en");
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  history.replaceState(null, "", url);
  applyLocale();
  for (const option of $("place-select").options)
    option.textContent = placeName({
      ...(regions[option.value] || city),
      id: option.value,
    });
  refreshSceneText();
  syncAppearance();
  syncPlaying();
  $("density-label").textContent = t(
    density < 25 ? "low" : density < 75 ? "medium" : "high",
  );
  draw();
};
addEventListener("pagehide", event => {
  cancelAnimationFrame(interactionFrame); interactionFrame = 0;
  pageVisible = false; schedule();
  loadController?.abort();
  exportUI.dispose();
  sceneUI.dispose();
  if (!event.persisted) { engine?.dispose(); cities.clear(); }
});
addEventListener("pageshow", () => { pageVisible = !document.hidden; draw(); schedule(); });
function schedule() {
  cancelAnimationFrame(animation); animation = 0; last = performance.now();
  if (engine?.playing && !busy && pageVisible) animation = requestAnimationFrame(animate);
}
function animate(now) {
  animation = 0;
  if (!engine?.playing || busy || !pageVisible) return;
  if (now - last < 1000 / 45) {
    animation = requestAnimationFrame(animate);
    return;
  }
  const dt = Math.min(0.08, (now - last) / 1000);
  last = now;
  engine.advance(dt * 1.7);
  draw();
  animation = requestAnimationFrame(animate);
}
const initialPlace = location.hash.slice(1);
await select(Object.hasOwn(regions, initialPlace) ? initialPlace : "sapporo");
schedule();
document.addEventListener("visibilitychange", () => {
  pageVisible = !document.hidden; draw(); schedule();
});
motion.addEventListener("change", () => {
  if (motion.matches) { playing = false; if (engine) engine.playing = false; syncPlaying(); }
});
