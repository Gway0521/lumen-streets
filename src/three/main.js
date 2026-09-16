import * as maplibregl from "maplibre-gl";
import mapWorkerURL from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { regions } from "../city.js";
import { nightStyle, ROAD_LIGHT } from "./style.js";
import { NightLayer } from "./layer.js";
import { CityStream } from "./stream.js";
import { viewRecipe, detailLevel, clamp, localPoint } from "./geo.js";
import { messages, cities } from "./locales.js";
import { geocoder } from "../search/providers.ts";
import { exportNight, download } from "./export.js";
import {
  ASPECTS,
  captureSize,
  paintComposition,
  labelFontText,
} from "./composition.js";
import { ensureTitleFonts } from "../export/title-fonts.ts";
import {
  validateScene,
  trafficRecipe,
  restoreTraffic,
} from "./scene-recipe.js";
import { VIEW, sceneZoom } from "./view.js";
import { importModel, MODEL_LIMITS } from "./model-import.js";

const params = new URLSearchParams(location.search),
  initial = viewRecipe(Object.fromEntries(params));
let locale = params.get("lang") === "zh-TW" ? "zh-TW" : "en",
  selected = params.get("name")?.slice(0, 120) || initial.city,
  statusKey = "loading",
  activePanel = null,
  stream,
  map;
const mobile =
  matchMedia("(max-width: 700px)").matches ||
  navigator.hardwareConcurrency <= 4;
if (mobile && !params.has("zoom")) initial.zoom = VIEW.mobile;
if (mobile && !params.has("density")) initial.density = 400;
if (
  mobile &&
  initial.city === "shanghai" &&
  !params.has("lng") &&
  !params.has("lat")
) {
  initial.lng = 121.5;
  initial.lat = 31.236;
}
let quality = "auto",
  orbit = false,
  focus = params.get("embed") === "1",
  capturing = false,
  exportAbort,
  modelFile,
  placedBuffer,
  modelObject,
  manifest,
  modelGeneration = 0,
  pendingScene = null;
let frameAspect = innerWidth / innerHeight,
  frameOnly = false,
  preferredResolution = "1920";
const $ = (id) => document.getElementById(id),
  t = (key) => messages[locale][key] || key;
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  explore: svg('<circle cx="12" cy="12" r="8"/><path d="m15 9-2 4-4 2 2-4Z"/>'),
  light: svg(
    '<path d="M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10M8 4v4m6 2v4m-4 2v4"/>',
  ),
  capture: svg('<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>'),
  models: svg('<path d="m4 9 8-5 8 5v11H4ZM9 20v-8h6v8"/>'),
};
const focusIcon = svg('<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>');
const githubIcon = svg(
  '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.6-.5-2.2 3.2-.4 6.5-1.6 6.5-7A5.4 5.4 0 0 0 19.5 5c.2-.9.2-2-.3-3-1.7 0-3 1-3.7 1.5a13 13 0 0 0-7 0C7.8 3 6.5 2 4.8 2c-.5 1-.5 2.1-.3 3A5.4 5.4 0 0 0 3 8.8c0 5.4 3.3 6.6 6.5 7C9 16.4 9 17 9 18v4"/>',
);
$("app").innerHTML =
  `<main id="map" aria-label="Interactive city nightscape"></main>
 <canvas id="composition-preview" hidden aria-hidden="true"></canvas><div id="frame-hint" hidden data-i18n="frameHint"></div><button id="finish-frame" hidden data-i18n="finishFrame"></button><div class="vignette"></div><header class="masthead chrome"><a class="brand" href="./"><img src="./favicon.svg" alt=""><span>Lumen Streets<small id="tagline"></small></span></a>
 <div class="header-actions"><a id="github" class="square" href="https://github.com/Gway0521/lumen-streets" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">${githubIcon}</a><button id="language"></button><button id="focus" class="square" title="Hide controls">${focusIcon}</button></div></header>
 <button id="restore" class="restore" data-i18n="restore"></button>
 <section id="panel" class="panel chrome" hidden aria-label="Settings"><button id="close-panel" class="close square" aria-label="Close">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button>
 <div data-panel="explore" hidden><p class="eyebrow">LUMEN STREETS / ATLAS</p><h2 data-i18n="city"></h2><form id="search-form"><input id="search-input" type="search" maxlength="160"><button data-i18n="find"></button></form><div id="search-results"></div><div class="cities" id="cities"></div></div>
 <div data-panel="light" hidden><p class="eyebrow">AERIAL GOLD</p><h2 data-i18n="light"></h2>
 <label><span data-i18n="glow"></span><output id="glow-value"></output><input id="glow" type="range" min=".4" max="1.6" step=".05"></label>
 <label><span data-i18n="density"></span><output id="density-value"></output><input id="density" type="range" min="0" max="1600" step="50"></label>
 <label><span data-i18n="tilt"></span><output id="pitch-value"></output><input id="pitch" type="range" min="0" max="55" step="1"></label>
 <label><span data-i18n="quality"></span><select id="quality"><option value="auto" data-i18n="auto"></option><option value="high" data-i18n="high"></option><option value="low" data-i18n="low"></option></select></label>
 <div class="pair"><button id="play"></button><button id="orbit" data-i18n="rotate" aria-pressed="false"></button></div></div>
 <div data-panel="capture" hidden><p class="eyebrow">KEEP A LITTLE OF THE NIGHT</p><h2 data-i18n="exportTitle"></h2><p data-i18n="exportHint"></p>
 <label><span data-i18n="format"></span><select id="format"><option value="png" data-i18n="png"></option><option value="gif" data-i18n="gif"></option><option value="video" data-i18n="video"></option></select></label>
 <div class="pair"><label><span data-i18n="resolution"></span><select id="resolution"><option value="720" disabled>720 px</option><option value="1920" selected>1920 px</option><option value="2560">2560 px</option><option value="3840">3840 px · 4K</option></select></label><label><span data-i18n="duration"></span><select id="duration"><option value="30">30 s</option><option value="60">1 min</option><option value="120">2 min</option><option value="180">3 min</option><option value="300">5 min</option></select></label></div>
 <label><span data-i18n="aspect"></span><select id="aspect"><option value="current" data-i18n="currentView"></option><option value="screen" data-i18n="thisScreen"></option>${Object.keys(
   ASPECTS,
 )
   .map((r) => `<option value="${r}">${r}</option>`)
   .join(
     "",
   )}<option value="custom" data-i18n="customRatio"></option></select></label>
 <div id="custom-ratio" class="pair" hidden><label><span data-i18n="width"></span><input id="ratio-width" type="number" value="1920" min="1" max="10000"></label><label><span data-i18n="heightRatio"></span><input id="ratio-height" type="number" value="1080" min="1" max="10000"></label></div><p id="output-size" class="fine"></p><button id="compose-full" data-i18n="composeFull"></button>
 <details><summary data-i18n="wallpaperOptions"></summary>
 <label><span data-i18n="dimSide"></span><select id="dim-side"><option value="none" data-i18n="none"></option><option value="left" data-i18n="left"></option><option value="right" data-i18n="right"></option><option value="top" data-i18n="top"></option><option value="bottom" data-i18n="bottom"></option></select></label>
 <label><span data-i18n="dimBrightness"></span><output id="dim-brightness-value">45%</output><input id="dim-brightness" type="range" min="0" max="100" value="45"></label>
 <label><span data-i18n="dimArea"></span><output id="dim-area-value">60%</output><input id="dim-area" type="range" min="1" max="100" value="60"></label>
 <label class="check"><input id="place-label" type="checkbox"><span data-i18n="placeName"></span></label>
 <div id="place-options" hidden><label><span data-i18n="caption"></span><input id="place-text" maxlength="120"></label><div class="pair"><label><span data-i18n="position"></span><select id="title-corner"><option value="bottom-left" data-i18n="bottomLeft"></option><option value="bottom-right" data-i18n="bottomRight"></option><option value="top-left" data-i18n="topLeft"></option><option value="top-right" data-i18n="topRight"></option></select></label><label><span data-i18n="textSize"></span><select id="title-size"><option value="small" data-i18n="small"></option><option value="medium" selected data-i18n="medium"></option><option value="large" data-i18n="large"></option></select></label></div></div>
 <label class="check"><input id="landmark-labels" type="checkbox"><span data-i18n="landmarkNames"></span></label></details>
 <button id="save" class="primary" data-i18n="save"></button><div class="pair"><button id="share" data-i18n="share"></button><button id="embed" data-i18n="embed"></button></div><textarea id="copy-fallback" hidden readonly></textarea><details><summary data-i18n="sceneFiles"></summary><div class="pair"><button id="save-scene" data-i18n="saveScene"></button><button id="open-scene" data-i18n="openScene"></button></div><input id="scene-file" type="file" accept=".json" hidden><p class="fine" data-i18n="sceneHint"></p></details></div>
 <div data-panel="models" hidden><p class="eyebrow">A CITY, BY ITS PEOPLE</p><h2 data-i18n="modelTitle"></h2><p data-i18n="modelHint"></p>
 <label><span data-i18n="modelName"></span><input id="model-name" maxlength="120"></label><label class="file"><span data-i18n="file"></span><input id="model-file" type="file" accept=".glb"></label><div class="pair"><label><span data-i18n="height"></span><input id="model-height" type="number" value="100" min="2" max="1000"></label><label><span data-i18n="bearing"></span><input id="model-bearing" type="number" value="0" min="-360" max="360"></label></div>
 <label><span data-i18n="author"></span><input id="model-author" maxlength="100"></label><label><span data-i18n="license"></span><select id="model-license"><option value="CC-BY-4.0">CC BY 4.0</option><option value="CC0-1.0">CC0</option><option value="CC-BY-SA-4.0">CC BY-SA 4.0</option></select></label><button id="place-model" class="primary" data-i18n="preview"></button><div class="pair"><button id="remove-model" disabled data-i18n="remove"></button><button id="model-manifest" disabled data-i18n="manifest"></button></div><p class="fine" data-i18n="local"></p><a class="submission-link" href="https://github.com/Gway0521/lumen-streets/issues/new?template=landmark.md" target="_blank" rel="noopener" data-i18n="submitModel"></a></div></section>
 <div class="navigation chrome"><button id="north" class="square">N<span id="needle">${svg('<path d="m8 17 4-12 4 12-4-3Z"/>')}</span></button><button id="zoom-in" class="square">${svg('<path d="M5 12h14M12 5v14"/>')}</button><button id="zoom-out" class="square">${svg('<path d="M5 12h14"/>')}</button></div>
 <footer class="scene-label chrome"><div class="eyebrow"><i></i><span id="status" role="status"></span></div><h1 id="city-title"></h1><p id="coordinates"></p></footer>
 <nav class="dock chrome" aria-label="Nightscape controls">${Object.keys(icons)
   .map(
     (key) =>
       `<button id="tab-${key}" data-tab="${key}" aria-expanded="false"><span class="icon">${icons[key]}</span><span data-i18n="${key}"></span></button>`,
   )
   .join("")}</nav>
 <div class="bottom-note chrome"><span id="gesture"></span><div><a href="./source.html" data-i18n="source"></a></div></div>
 <div id="toast" role="status" hidden></div><div id="network" class="network" hidden><span data-i18n="network"></span><button id="retry" data-i18n="retry"></button></div>
 <div id="export-progress" class="export-progress" hidden><p data-i18n="captureBusy"></p><progress max="1" value="0"></progress><output id="export-percent">0%</output><button id="cancel-export" data-i18n="cancel"></button></div>`;
function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function compositionOptions() {
  return {
    quiet: {
      edge: $("dim-side").value,
      brightness: Number($("dim-brightness").value),
      area: Number($("dim-area").value),
    },
    placeTitle: $("place-label").checked
      ? {
          text: $("place-text").value.replace(/[\u0000-\u001f\u007f]/g, ""),
          corner: $("title-corner").value,
          size: $("title-size").value,
        }
      : undefined,
    landmarkLabels: $("landmark-labels").checked,
    locale,
  };
}
function selectedAspect() {
  const value = $("aspect").value;
  if (value === "screen") return screen.width / screen.height;
  if (value === "custom")
    return clamp(
      Number($("ratio-width").value) / Number($("ratio-height").value) ||
        frameAspect,
      0.25,
      4,
    );
  return ASPECTS[value] || frameAspect;
}
function layoutCapture() {
  if (!map) return;
  const active = activePanel === "capture",
    container = $("map"),
    overlay = $("composition-preview");
  const center = map.getCenter(),
    oldHeight = map.getCanvas().clientHeight,
    zoom = map.getZoom();
  const resize = () => {
    const height = container.getBoundingClientRect().height;
    map.lumenZoomOffset = active ? Math.log2(innerHeight / height) : 0;
    map.setMinZoom(Math.max(0, 2 - map.lumenZoomOffset));
    map.setMaxZoom(VIEW.nearest - map.lumenZoomOffset);
    map.resize();
    map.jumpTo({ center, zoom: zoom + Math.log2(height / oldHeight) });
  };
  overlay.hidden = $("frame-hint").hidden = !active;
  if (!active) {
    container.removeAttribute("style");
    resize();
    return;
  }
  const narrow = innerWidth < 800,
    margin = narrow ? 14 : 32;
  const availableWidth = innerWidth - (frameOnly || narrow ? margin * 2 : 440);
  const availableHeight = frameOnly
    ? innerHeight - 160
    : narrow
      ? Math.max(110, innerHeight * 0.4 - 35)
      : innerHeight - 175;
  const aspect = selectedAspect();
  const w = Math.max(
    64,
    Math.floor(Math.min(availableWidth, availableHeight * aspect)),
  );
  const h = Math.max(64, Math.round(w / aspect));
  const left = margin + (availableWidth - w) / 2,
    top = narrow
      ? 60 + (availableHeight - h) / 2
      : 65 + (availableHeight - h) / 2;
  container.style.cssText = `inset:auto;left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
  overlay.style.cssText = container.style.cssText;
  $("frame-hint").style.cssText =
    `left:${margin}px;top:${narrow ? 40 : 28}px;width:${availableWidth}px`;
  resize();
  updateComposition();
}
function drawCompositionPreview() {
  if (
    (activePanel !== "capture" && !(focus && params.get("embed") === "1")) ||
    capturing ||
    !map
  )
    return;
  const canvas = $("composition-preview"),
    rect = map.getCanvas();
  if (focus && params.get("embed") === "1") {
    canvas.hidden = false;
    canvas.style.cssText = "inset:0;width:100%;height:100%";
  }
  const [width, height] = captureSize(
    activePanel === "capture"
      ? selectedAspect()
      : rect.clientWidth / rect.clientHeight,
    Number($("resolution").value),
    $("format").value,
  );
  // Draw in output coordinates so typography and gradients match the saved file.
  const scale =
    (Math.min(2, devicePixelRatio || 1) *
      Math.max(rect.clientWidth, rect.clientHeight)) /
    Math.max(width, height);
  if (
    canvas.width !== Math.round(width * scale) ||
    canvas.height !== Math.round(height * scale)
  ) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / width, canvas.height / height);
  paintComposition(ctx, width, height, compositionOptions(), layer);
}
let fontRequest = 0;
function updateComposition() {
  $("place-options").hidden = !$("place-label").checked;
  $("custom-ratio").hidden = $("aspect").value !== "custom";
  for (const id of ["dim-brightness", "dim-area"]) {
    $(`${id}-value`).value = `${$(id).value}%`;
    $(id).disabled = $("dim-side").value === "none";
  }
  const [w, h] = captureSize(
    selectedAspect(),
    Number($("resolution").value),
    $("format").value,
  );
  $("output-size").textContent = `${w} × ${h} px`;
  drawCompositionPreview();
  const text = compositionOptions().placeTitle?.text || "";
  const names = $("landmark-labels").checked
    ? labelFontText(layer, locale)
    : "";
  clearTimeout(fontRequest);
  fontRequest = setTimeout(
    () =>
      ensureTitleFonts(`${text} ${names}`)
        .then(drawCompositionPreview)
        .catch(() => notify(t("fontError"))),
    250,
  );
}
window.addEventListener("resize", () => {
  if (!capturing) layoutCapture();
});
function setStatus(key) {
  statusKey = key;
  if (
    ["ready", "budget"].includes(key) &&
    (activePanel === "capture" || (focus && params.get("embed") === "1"))
  )
    updateComposition();
  $("status").textContent = t(key);
  if (pendingScene && ["ready", "budget"].includes(key)) {
    const scene = pendingScene;
    pendingScene = null;
    const traffic = scene.traffic && {
      ...scene.traffic,
      cars: scene.traffic.cars.slice(0, mobile ? 800 : 1600),
    };
    const exact =
      restoreTraffic(layer.traffic, traffic) &&
      traffic?.cars.length === scene.traffic?.cars.length;
    layer.time = scene.time;
    layer.playing = scene.playing;
    layer.accumulator = 0;
    layer.updatePoints();
    $("play").textContent = t(layer.playing ? "play" : "paused");
    notify(t(exact || !scene.traffic ? "sceneLoaded" : "sceneUpdated"));
  }
}
function cityName(id = selected) {
  return cities[id]?.[locale === "en" ? 0 : 1] || id;
}
function translate() {
  document.documentElement.lang = locale;
  document
    .querySelectorAll("[data-i18n]")
    .forEach((e) => (e.textContent = t(e.dataset.i18n)));
  $("tagline").textContent = t("tagline");
  $("language").textContent = t("language");
  updatePlaceLabel();
  $("search-input").placeholder = t("search");
  $("search-input").setAttribute("aria-label", t("search"));
  $("gesture").textContent = t(mobile ? "mobileGesture" : "gesture");
  $("play").textContent = t(layer.playing ? "play" : "paused");
  ["north", "zoom-in", "zoom-out", "focus"].forEach((id, i) => {
    $(id).title = t(["north", "zoomIn", "zoomOut", "focus"][i]);
    $(id).setAttribute("aria-label", $(id).title);
  });
  $("close-panel").setAttribute("aria-label", t("close"));
  setStatus(statusKey);
  renderCities();
  if (activePanel === "capture") updateComposition();
}
function renderCities() {
  const container = $("cities");
  container.replaceChildren();
  for (const id of Object.keys(cities)) {
    const button = document.createElement("button");
    button.textContent = cityName(id);
    button.classList.toggle("selected", selected === id);
    button.onclick = () => chooseCity(id);
    container.append(button);
  }
}
function updatePlaceLabel() {
  const center = map?.getCenter().toArray() || [initial.lng, initial.lat];
  const near =
    regions[selected] &&
    Math.hypot(...localPoint(...center, regions[selected].center)) < 4000;
  $("city-title").textContent =
    regions[selected] && !near
      ? locale === "en"
        ? "Night atlas"
        : "世界夜色"
      : cityName();
  if (!params.has("debug"))
    $("coordinates").textContent =
      `${Math.abs(center[1]).toFixed(4)}° ${center[1] >= 0 ? "N" : "S"}  /  ${Math.abs(center[0]).toFixed(4)}° ${center[0] >= 0 ? "E" : "W"}`;
}
function togglePanel(id) {
  if (capturing) return;
  const wasCapture = activePanel === "capture";
  activePanel = activePanel === id ? null : id;
  frameOnly = false;
  document.body.classList.remove("frame-only");
  $("finish-frame").hidden = true;
  if (activePanel === "capture" && !wasCapture) {
    frameAspect = map.getCanvas().clientWidth / map.getCanvas().clientHeight;
    if (!$("place-text").value)
      $("place-text").value = $("city-title").textContent.slice(0, 120);
  }
  document.body.classList.toggle("composing", activePanel === "capture");
  document.body.classList.toggle("panel-open", Boolean(activePanel));
  layoutCapture();
  $("panel").hidden = !activePanel;
  document
    .querySelectorAll("[data-panel]")
    .forEach((e) => (e.hidden = e.dataset.panel !== activePanel));
  document
    .querySelectorAll("[data-tab]")
    .forEach((e) =>
      e.setAttribute("aria-expanded", String(e.dataset.tab === activePanel)),
    );
}
function setFocus(value) {
  if (value && activePanel) togglePanel(null);
  focus = value;
  document.body.classList.toggle("focus", focus);
  if (!focus && activePanel !== "capture")
    $("composition-preview").hidden = true;
  map?.triggerRepaint();
}
const layer = new NightLayer({
  mobile,
  onStats: (stats) => {
    if (params.has("debug"))
      $("coordinates").textContent =
        `${stats.buildings || 0} buildings · ${(stats.geometryMiB || 0).toFixed(1)} MiB · ${stats.cars || 0} cars · ${stats.drawCalls || 0} calls`;
  },
});
layer.glow = initial.glow;
layer.density = Math.min(initial.density, mobile ? 800 : 1600);
if (params.has("playing")) layer.playing = params.get("playing") === "1";
translate();
setFocus(focus);
try {
  maplibregl.setWorkerCount(mobile ? 2 : 4);
  maplibregl.setWorkerUrl(mapWorkerURL);
  map = new maplibregl.Map({
    container: "map",
    style: nightStyle(import.meta.env.VITE_LUMEN_TILEJSON_URL || undefined),
    center: [initial.lng, initial.lat],
    zoom: initial.zoom,
    bearing: initial.bearing,
    pitch: initial.pitch,
    minZoom: 2,
    maxZoom: VIEW.nearest,
    aroundCenter: false,
    rotateSpeed: 0.25,
    maxPitch: 55,
    renderWorldCopies: false,
    pixelRatio: Math.min(devicePixelRatio, mobile ? 1.25 : 1.75),
    maxTileCacheSize: mobile ? 64 : 160,
    maxTileCacheZoomLevels: 2,
    canvasContextAttributes: {
      contextType: "webgl2",
      antialias: !mobile,
      preserveDrawingBuffer: true,
      powerPreference: mobile ? "low-power" : "high-performance",
    },
    attributionControl: { compact: true },
  });
  map.on("load", () => {
    map.addLayer(layer);
    stream = new CityStream(map, layer, {
      mobile,
      status: setStatus,
      city: initial.city,
    });
    stream.schedule();
    $("glow").oninput({ target: $("glow") });
    updatePlaceLabel();
  });
  map.on("error", (event) => {
    if (
      event.error?.message?.includes("Failed to fetch") ||
      event.error?.status >= 400
    ) {
      $("network").hidden = false;
    }
  });
  map.on("sourcedata", (e) => {
    if (e.sourceId === "world" && e.isSourceLoaded) $("network").hidden = true;
  });
  map.on("move", () => {
    const p = map.getCenter();
    $("needle").style.transform = `rotate(${-map.getBearing()}deg)`;
    $("pitch").value = String(Math.round(map.getPitch()));
    $("pitch-value").value = `${Math.round(map.getPitch())}°`;
    if (!params.has("debug"))
      $("coordinates").textContent =
        `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? "N" : "S"}  /  ${Math.abs(p.lng).toFixed(4)}° ${p.lng >= 0 ? "E" : "W"}`;
  });
  map.on("moveend", () => {
    if (detailLevel(sceneZoom(map)) === "map") setStatus("map");
    updatePlaceLabel();
  });
  map.on("render", drawCompositionPreview);
  map.getCanvas().addEventListener("webglcontextlost", () => {
    layer.playing = false;
    notify(
      locale === "en"
        ? "Graphics paused. Reload to restore the scene."
        : "圖形繪製已暫停，請重新載入以恢復。",
    );
  });
} catch (error) {
  $("network").hidden = false;
  $("network").firstElementChild.textContent =
    locale === "en"
      ? "WebGL 2 is unavailable. Enable hardware acceleration or try another browser."
      : "無法使用 WebGL 2。請開啟硬體加速，或使用其他瀏覽器。";
}
function chooseCity(id) {
  if (!map || capturing) return;
  selected = id;
  stream?.setCity(id);
  $("city-title").textContent = cityName();
  renderCities();
  const camera = {
    center:
      id === "shanghai"
        ? mobile
          ? [121.5, 31.236]
          : [121.4938, 31.2359]
        : regions[id].center,
    zoom: mobile ? VIEW.mobile : VIEW.desktop,
    pitch: VIEW.pitch,
    bearing: id === "shanghai" ? -8 : 0,
    duration: 1000,
  };
  // Closing a capture frame resizes/jumps the camera. Finish that first so it
  // cannot cancel the navigation that follows.
  if (mobile) togglePanel(null);
  map.stop();
  if (
    Math.hypot(...localPoint(...camera.center, map.getCenter().toArray())) >
    50000
  )
    map.jumpTo(camera);
  else map.flyTo(camera);
}
document
  .querySelectorAll("[data-tab]")
  .forEach((e) => (e.onclick = () => togglePanel(e.dataset.tab)));
$("close-panel").onclick = () => togglePanel(null);
$("language").onclick = () => {
  locale = locale === "en" ? "zh-TW" : "en";
  translate();
};
$("focus").onclick = () => setFocus(true);
$("restore").onclick = () => setFocus(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (capturing) exportAbort?.abort();
    else if (focus) setFocus(false);
    else togglePanel(null);
  }
});
$("north").onclick = () => map?.easeTo({ bearing: 0, duration: 500 });
$("zoom-in").onclick = () => map?.zoomIn();
$("zoom-out").onclick = () => map?.zoomOut();
$("glow").value = String(layer.glow);
$("glow-value").value = `${Math.round(layer.glow * 100)}%`;
$("glow").oninput = (e) => {
  layer.glow = Number(e.target.value);
  $("glow-value").value = `${Math.round(layer.glow * 100)}%`;
  for (const id of ["road-halo", "road-glow", "road-rim"])
    if (map?.getLayer(id))
      map.setPaintProperty(
        id,
        "line-opacity",
        clamp(ROAD_LIGHT[id] * layer.glow, 0, 1),
      );
  map?.triggerRepaint();
};
$("density").value = String(layer.density);
$("density").max = mobile ? "800" : "1600";
$("density-value").value = String(layer.density);
$("density").oninput = (e) => {
  layer.setDensity(Number(e.target.value));
  $("density-value").value = e.target.value;
};
$("pitch").value = String(initial.pitch);
$("pitch-value").value = `${initial.pitch}°`;
$("pitch").oninput = (e) => map?.jumpTo({ pitch: Number(e.target.value) });
$("play").onclick = () => {
  layer.playing = !layer.playing;
  layer.last = performance.now();
  $("play").textContent = t(layer.playing ? "play" : "paused");
};
$("orbit").onclick = () => {
  orbit = !orbit;
  $("orbit").setAttribute("aria-pressed", String(orbit));
};
$("quality").onchange = (e) => {
  quality = e.target.value;
  map?.setPixelRatio(
    Math.min(
      devicePixelRatio,
      quality === "low" ? 1 : quality === "high" ? 2 : mobile ? 1.25 : 1.75,
    ),
  );
};
$("retry").onclick = () => {
  if (!map) return;
  $("network").hidden = true;
  map.getSource("world")?.reload();
  stream?.schedule();
};
let searchController;
$("search-form").onsubmit = async (e) => {
  e.preventDefault();
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  const q = $("search-input").value.trim();
  if (q.length < 2) return;
  const results = $("search-results");
  results.textContent = t("searching");
  try {
    const found = await geocoder.search(q, locale, controller.signal);
    if (controller.signal.aborted) return;
    results.replaceChildren();
    if (!found.length) results.textContent = t("empty");
    for (const place of found.slice(0, 5)) {
      const button = document.createElement("button");
      button.textContent = `${place.name} · ${place.context}`;
      button.onclick = () => {
        if (capturing) return;
        togglePanel(null);
        map.stop();
        selected = place.name;
        $("city-title").textContent = place.name;
        stream?.setCity(null);
        const camera = {
          center: place.center,
          zoom: VIEW.desktop,
          pitch: VIEW.pitch,
          duration: 1000,
        };
        if (
          Math.hypot(
            ...localPoint(...place.center, map.getCenter().toArray()),
          ) > 50000
        )
          map.jumpTo(camera);
        else map.flyTo(camera);
        renderCities();
      };
      results.append(button);
    }
  } catch (error) {
    if (!controller.signal.aborted) results.textContent = t("searchError");
  }
};
function link(embed = false) {
  const url = new URL("./three.html", location.href),
    p = map.getCenter();
  const recipe = {
    city: regions[selected] ? selected : initial.city,
    ...(!regions[selected] ? { name: String(selected).slice(0, 120) } : {}),
    lng: p.lng.toFixed(6),
    lat: p.lat.toFixed(6),
    zoom: sceneZoom(map).toFixed(3),
    pitch: map.getPitch().toFixed(2),
    bearing: map.getBearing().toFixed(2),
    glow: layer.glow,
    density: layer.density,
    lang: locale,
  };
  for (const [k, v] of Object.entries(recipe))
    url.searchParams.set(k, String(v));
  if (embed) {
    url.searchParams.set("embed", "1");
    const composition = compositionOptions();
    for (const [key, value] of Object.entries({
      caption: composition.placeTitle?.text || "",
      corner: composition.placeTitle?.corner || "bottom-left",
      textSize: composition.placeTitle?.size || "medium",
      labels: composition.landmarkLabels ? "1" : "0",
      shade: composition.quiet.edge,
      brightness: composition.quiet.brightness,
      area: composition.quiet.area,
    }))
      url.searchParams.set(key, String(value));
  }
  url.searchParams.set("playing", layer.playing ? "1" : "0");
  return url.href;
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify(t("copied"));
  } catch {
    $("copy-fallback").hidden = false;
    $("copy-fallback").value = text;
    $("copy-fallback").select();
    notify(t("copyError"));
  }
}
$("share").onclick = () => copy(link());
$("embed").onclick = () =>
  copy(
    `<iframe src="${link(true).replaceAll("&", "&amp;")}" title="Lumen Streets city nightscape" width="100%" height="600" loading="lazy" allow="fullscreen" style="border:0;border-radius:12px"></iframe>`,
  );
$("format").onchange = () => {
  $("duration").disabled = $("format").value !== "video";
  $("duration").closest("label").hidden = $("format").value !== "video";
  if ($("format").value === "gif") {
    preferredResolution =
      $("resolution").value === "720"
        ? preferredResolution
        : $("resolution").value;
    $("resolution").value = "720";
  } else if ($("resolution").value === "720")
    $("resolution").value = preferredResolution;
  $("resolution").disabled = $("format").value === "gif";
  $("resolution").querySelector('[value="3840"]').disabled =
    $("format").value === "video";
  if ($("format").value === "video" && Number($("resolution").value) > 2560)
    $("resolution").value = "2560";
  updateComposition();
};
for (const id of ["aspect", "ratio-width", "ratio-height"])
  $(id).oninput = layoutCapture;
for (const id of [
  "resolution",
  "dim-side",
  "dim-brightness",
  "dim-area",
  "place-label",
  "place-text",
  "title-corner",
  "title-size",
  "landmark-labels",
])
  $(id).oninput = updateComposition;
if (params.get("embed") === "1") {
  const pick = (id, key, allowed) => {
    if (allowed.includes(params.get(key))) $(id).value = params.get(key);
  };
  pick("dim-side", "shade", ["none", "left", "right", "top", "bottom"]);
  pick("title-corner", "corner", [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ]);
  pick("title-size", "textSize", ["small", "medium", "large"]);
  $("place-text").value = (params.get("caption") || "")
    .slice(0, 120)
    .replace(/[\u0000-\u001f\u007f]/g, "");
  $("place-label").checked = !!$("place-text").value;
  $("landmark-labels").checked = params.get("labels") === "1";
  for (const [id, key, min, max] of [
    ["dim-brightness", "brightness", 0, 100],
    ["dim-area", "area", 1, 100],
  ])
    if (params.has(key) && Number.isFinite(Number(params.get(key))))
      $(id).value = clamp(Number(params.get(key)), min, max);
}
$("format").onchange();
$("compose-full").onclick = () => {
  frameOnly = true;
  document.body.classList.add("frame-only");
  $("finish-frame").hidden = false;
  layoutCapture();
};
$("finish-frame").onclick = () => {
  frameOnly = false;
  document.body.classList.remove("frame-only");
  $("finish-frame").hidden = true;
  layoutCapture();
};
$("save").onclick = async () => {
  if (
    capturing ||
    !stream ||
    (sceneZoom(map) >= VIEW.atlas &&
      (!stream.ready || stream.busy || !layer.mesh))
  ) {
    notify(t("notReady"));
    return;
  }
  capturing = true;
  exportAbort = new AbortController();
  $("export-progress").hidden = false;
  document.body.classList.add("capturing");
  const progress = $("export-progress").querySelector("progress");
  progress.value = 0;
  $("export-percent").value = "0%";
  try {
    const result = await exportNight({
      map,
      layer,
      stream,
      format: $("format").value,
      longEdge: Number($("resolution").value),
      duration: Number($("duration").value),
      composition: compositionOptions(),
      aspect: selectedAspect(),
      signal: exportAbort.signal,
      progress: (value) => {
        progress.value = value;
        $("export-percent").value = `${Math.round(value * 100)}%`;
      },
    });
    if (exportAbort.signal.aborted) {
      await result.release?.();
      return;
    }
    download(result.blob, `lumen-streets.${result.extension}`, result.release);
  } catch (error) {
    if (!exportAbort.signal.aborted)
      notify(
        t(
          error.message.includes("storage") ||
            error.message === "VIDEO_STORAGE_UNAVAILABLE"
            ? "storageError"
            : error.message.includes("encoding is unavailable")
              ? "codecError"
              : error.message.includes("FONT")
                ? "fontError"
                : "captureError",
        ),
      );
  } finally {
    capturing = false;
    $("export-progress").hidden = true;
    document.body.classList.remove("capturing");
  }
};
$("cancel-export").onclick = () => exportAbort?.abort();
$("save-scene").onclick = () => {
  if (!stream?.ready || stream.busy || capturing) {
    notify(t("notReady"));
    return;
  }
  const p = map.getCenter();
  const scene = validateScene({
    format: "lumen-streets-view",
    version: 1,
    name: String(cityName())
      .slice(0, 120)
      .replace(/[\u0000-\u001f\u007f]/g, ""),
    view: {
      city: stream.city || initial.city,
      lng: p.lng,
      lat: p.lat,
      zoom: sceneZoom(map),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      glow: layer.glow,
      density: layer.density,
    },
    time: layer.time,
    playing: layer.playing,
    aspect: selectedAspect(),
    composition: compositionOptions(),
    traffic: trafficRecipe(layer.traffic),
  });
  download(
    new Blob([JSON.stringify(scene)], { type: "application/json" }),
    "nightscape.lumen-view.json",
  );
};
$("open-scene").onclick = () => $("scene-file").click();
$("scene-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || capturing) return;
  try {
    if (file.size > 1500000) throw Error("Scene too large");
    const scene = validateScene(JSON.parse(await file.text())),
      c = scene.composition;
    pendingScene = scene;
    layer.playing = false;
    locale = c.locale;
    selected = cities[scene.view.city]?.includes(scene.name)
      ? scene.view.city
      : scene.name || scene.view.city;
    $("dim-side").value = c.quiet.edge;
    $("dim-brightness").value = c.quiet.brightness;
    $("dim-area").value = c.quiet.area;
    $("place-label").checked = !!c.placeTitle;
    $("place-text").value = c.placeTitle?.text || scene.name;
    $("title-corner").value = c.placeTitle?.corner || "bottom-left";
    $("title-size").value = c.placeTitle?.size || "medium";
    $("landmark-labels").checked = c.landmarkLabels;
    $("aspect").value = "custom";
    $("ratio-width").value = Math.round(scene.aspect * 1000);
    $("ratio-height").value = 1000;
    layer.glow = scene.view.glow;
    $("glow").value = layer.glow;
    $("glow").oninput({ target: $("glow") });
    layer.setDensity(Math.min(scene.view.density, mobile ? 800 : 1600));
    $("density").value = layer.density;
    $("density-value").value = layer.density;
    if (activePanel !== "capture") togglePanel("capture");
    else layoutCapture();
    translate();
    stream.setCity(scene.view.city);
    map.stop();
    map.jumpTo({
      center: [scene.view.lng, scene.view.lat],
      zoom: scene.view.zoom - (map.lumenZoomOffset || 0),
      pitch: scene.view.pitch,
      bearing: scene.view.bearing,
    });
    if (scene.view.zoom < VIEW.atlas) {
      pendingScene = null;
      layer.time = scene.time;
      layer.playing = scene.playing;
      notify(t("sceneLoaded"));
    }
  } catch (error) {
    pendingScene = null;
    notify(t("sceneError"));
  }
};
$("model-file").onchange = (e) => {
  modelFile = e.target.files[0];
  if (modelFile && !$("model-name").value)
    $("model-name").value = modelFile.name.replace(/\.glb$/i, "").slice(0, 120);
};
$("place-model").onclick = async () => {
  if (
    !modelFile ||
    !$("model-author").value.trim() ||
    !$("model-name").value.trim()
  ) {
    notify(t("modelRequired"));
    return;
  }
  const generation = ++modelGeneration;
  try {
    if (modelFile.size > MODEL_LIMITS.bytes)
      throw Error("Maximum GLB size: 8 MB.");
    const file = modelFile;
    const details = {
      name: $("model-name").value.trim(),
      creator: $("model-author").value.trim(),
      license: $("model-license").value,
    };
    const buffer = await file.arrayBuffer(),
      anchor = map.getCenter().toArray(),
      height = Number($("model-height").value),
      bearing = Number($("model-bearing").value);
    const object = await importModel(buffer, { anchor, height, bearing });
    object.userData.name = details.name;
    if (generation !== modelGeneration) {
      layer.disposeObject(object);
      return;
    }
    if (modelObject) {
      layer.uploads.remove(modelObject);
      layer.disposeObject(modelObject);
    }
    placedBuffer = buffer.slice(0);
    modelObject = object;
    layer.uploads.add(object);
    layer.updateUploads();
    map.triggerRepaint();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    manifest = {
      version: 1,
      format: "glb",
      file: file.name,
      name: details.name,
      sha256: [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      anchor,
      height,
      bearing,
      creator: details.creator,
      license: details.license,
      triangles: object.userData.triangles,
    };
    $("remove-model").disabled = $("model-manifest").disabled = false;
    notify(t(sceneZoom(map) < VIEW.atlas ? "modelOnly" : "modelPlaced"));
  } catch (error) {
    notify(error.message);
  }
};
$("remove-model").onclick = () => {
  modelGeneration++;
  if (modelObject) {
    layer.uploads.remove(modelObject);
    layer.disposeObject(modelObject);
    modelObject = null;
    manifest = null;
    placedBuffer = null;
  }
  $("remove-model").disabled = $("model-manifest").disabled = true;
  map.triggerRepaint();
};
$("model-manifest").onclick = async () => {
  if (
    !manifest ||
    !placedBuffer ||
    capturing ||
    !stream?.ready ||
    stream.busy
  ) {
    notify(t("notReady"));
    return;
  }
  capturing = true;
  exportAbort = new AbortController();
  $("export-progress").hidden = false;
  document.body.classList.add("capturing");
  const progress = $("export-progress").querySelector("progress");
  progress.value = 0;
  try {
    const { contributionPackage } = await import("./contribution.js");
    const preview = await exportNight({
      map,
      layer,
      stream,
      format: "png",
      longEdge: 1200,
      signal: exportAbort.signal,
    });
    exportAbort.signal.throwIfAborted();
    const zip = await contributionPackage(placedBuffer, manifest, preview.blob);
    exportAbort.signal.throwIfAborted();
    download(zip, "lumen-landmark.zip");
    progress.value = 1;
  } catch (error) {
    if (!exportAbort.signal.aborted) notify(t("packageError"));
  } finally {
    capturing = false;
    $("export-progress").hidden = true;
    document.body.classList.remove("capturing");
  }
};
let lastFrame = performance.now(),
  frames = 0,
  frameTime = 0;
const timer = setInterval(
  () => {
    if (!map || document.hidden || capturing) return;
    const now = performance.now(),
      dt = now - lastFrame;
    lastFrame = now;
    if (orbit && activePanel !== "capture" && !map.isMoving()) {
      map.jumpTo({ bearing: map.getBearing() + 0.035 });
    }
    if (
      layer.playing &&
      (layer.density > 0 ||
        layer.routes.length > 0 ||
        layer.stats?.beacons > 0) &&
      sceneZoom(map) >= VIEW.traffic
    )
      map.triggerRepaint();
    frames++;
    frameTime += dt;
    if (frames === 150) {
      if (
        quality === "auto" &&
        frameTime / frames > 55 &&
        map.getPixelRatio() > 1
      )
        map.setPixelRatio(Math.max(1, map.getPixelRatio() - 0.25));
      frames = frameTime = 0;
    }
  },
  mobile ? 33 : 16,
);
document.addEventListener("visibilitychange", () => {
  layer.last = 0;
  lastFrame = performance.now();
  if (!document.hidden) map?.triggerRepaint();
});
window.addEventListener(
  "pagehide",
  () => {
    exportAbort?.abort();
    clearInterval(timer);
    searchController?.abort();
    stream?.dispose();
    map?.remove();
  },
  { once: true },
);
// Development-only renderer diagnostics.
if (import.meta.env.DEV)
  window.__lumen3d = {
    map,
    layer,
    get stream() {
      return stream;
    },
  };
