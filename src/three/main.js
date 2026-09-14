import * as maplibregl from "maplibre-gl";
import mapWorkerURL from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { regions } from "../city.js";
import { nightStyle } from "./style.js";
import { NightLayer } from "./layer.js";
import { CityStream } from "./stream.js";
import { viewRecipe, detailLevel, clamp, localPoint } from "./geo.js";
import { messages, cities } from "./locales.js";
import { geocoder } from "../search/providers.ts";
import { exportNight, download } from "./export.js";
import { importModel, MODEL_LIMITS } from "./model-import.js";

const params = new URLSearchParams(location.search),
  initial = viewRecipe(Object.fromEntries(params));
let locale = params.get("lang") === "zh-TW" ? "zh-TW" : "en",
  selected = initial.city,
  statusKey = "loading",
  activePanel = null,
  stream,
  map;
const mobile =
  matchMedia("(max-width: 700px)").matches ||
  navigator.hardwareConcurrency <= 4;
if (mobile && !params.has("zoom")) initial.zoom = 14.9;
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
  modelObject,
  manifest,
  modelGeneration = 0;
const $ = (id) => document.getElementById(id),
  t = (key) => messages[locale][key] || key;
const icons = { explore: "◉", light: "☷", capture: "↗", models: "⌂" };
$("app").innerHTML =
  `<main id="map" aria-label="Interactive city nightscape"></main>
 <div class="vignette"></div><header class="masthead chrome"><a class="brand" href="./three.html"><img src="./favicon.svg" alt=""><span>Lumen Streets<small id="tagline"></small></span></a>
 <div class="header-actions"><span class="preview" data-i18n="about"></span><button id="language"></button><button id="focus" class="square" title="Hide controls">⛶</button></div></header>
 <button id="restore" class="restore" data-i18n="restore"></button>
 <section id="panel" class="panel chrome" hidden aria-label="Settings"><button id="close-panel" class="close" aria-label="Close">×</button>
 <div data-panel="explore" hidden><p class="eyebrow">LUMEN STREETS / ATLAS</p><h2 data-i18n="city"></h2><form id="search-form"><input id="search-input" type="search" maxlength="160"><button data-i18n="find"></button></form><div id="search-results"></div><div class="cities" id="cities"></div></div>
 <div data-panel="light" hidden><p class="eyebrow">AERIAL GOLD</p><h2 data-i18n="light"></h2>
 <label><span data-i18n="glow"></span><output id="glow-value"></output><input id="glow" type="range" min=".4" max="1.6" step=".05"></label>
 <label><span data-i18n="density"></span><output id="density-value"></output><input id="density" type="range" min="0" max="1600" step="50"></label>
 <label><span data-i18n="tilt"></span><output id="pitch-value"></output><input id="pitch" type="range" min="0" max="60" step="1"></label>
 <label><span data-i18n="quality"></span><select id="quality"><option value="auto" data-i18n="auto"></option><option value="high" data-i18n="high"></option><option value="low" data-i18n="low"></option></select></label>
 <div class="pair"><button id="play"></button><button id="orbit" data-i18n="rotate" aria-pressed="false"></button></div></div>
 <div data-panel="capture" hidden><p class="eyebrow">KEEP A LITTLE OF THE NIGHT</p><h2 data-i18n="exportTitle"></h2><p data-i18n="exportHint"></p>
 <label><span data-i18n="format"></span><select id="format"><option value="png" data-i18n="png"></option><option value="gif" data-i18n="gif"></option><option value="video" data-i18n="video"></option></select></label>
 <div class="pair"><label><span data-i18n="resolution"></span><select id="resolution"><option value="1920">1920 px</option><option value="2560">2560 px</option><option value="3840">3840 px · 4K</option></select></label><label><span data-i18n="duration"></span><select id="duration"><option value="6">6 s</option><option value="15">15 s</option><option value="30">30 s</option></select></label></div>
 <button id="save" class="primary" data-i18n="save"></button><div class="pair"><button id="share" data-i18n="share"></button><button id="embed" data-i18n="embed"></button></div><textarea id="copy-fallback" hidden readonly></textarea></div>
 <div data-panel="models" hidden><p class="eyebrow">A CITY, BY ITS PEOPLE</p><h2 data-i18n="modelTitle"></h2><p data-i18n="modelHint"></p>
 <label class="file"><span data-i18n="file"></span><input id="model-file" type="file" accept=".glb"></label><div class="pair"><label><span data-i18n="height"></span><input id="model-height" type="number" value="100" min="2" max="1000"></label><label><span data-i18n="bearing"></span><input id="model-bearing" type="number" value="0" min="-360" max="360"></label></div>
 <label><span data-i18n="author"></span><input id="model-author" maxlength="100"></label><label><span data-i18n="license"></span><select id="model-license"><option value="CC-BY-4.0">CC BY 4.0</option><option value="CC0-1.0">CC0</option><option value="CC-BY-SA-4.0">CC BY-SA 4.0</option></select></label><button id="place-model" class="primary" data-i18n="preview"></button><div class="pair"><button id="remove-model" disabled data-i18n="remove"></button><button id="model-manifest" disabled data-i18n="manifest"></button></div><p class="fine" data-i18n="local"></p></div></section>
 <div class="navigation chrome"><button id="north" class="square">N<span id="needle">↑</span></button><button id="zoom-in" class="square">+</button><button id="zoom-out" class="square">−</button></div>
 <footer class="scene-label chrome"><div class="eyebrow"><i></i><span id="status" role="status"></span></div><h1 id="city-title"></h1><p id="coordinates"></p></footer>
 <nav class="dock chrome" aria-label="Nightscape controls">${Object.keys(icons)
   .map(
     (key) =>
       `<button id="tab-${key}" data-tab="${key}" aria-expanded="false"><span class="icon">${icons[key]}</span><span data-i18n="${key}"></span></button>`,
   )
   .join("")}</nav>
 <div class="bottom-note chrome"><span id="gesture"></span><div><a href="./index.html" data-i18n="classic"></a><span>·</span><a href="./source.html" data-i18n="source"></a></div></div>
 <div id="toast" role="status" hidden></div><div id="network" class="network" hidden><span data-i18n="network"></span><button id="retry" data-i18n="retry"></button></div>
 <div id="export-progress" class="export-progress" hidden><p data-i18n="captureBusy"></p><progress max="1" value="0"></progress><button id="cancel-export" data-i18n="cancel"></button></div>`;
function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function setStatus(key) {
  statusKey = key;
  $("status").textContent = t(key);
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
  activePanel = activePanel === id ? null : id;
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
  focus = value;
  document.body.classList.toggle("focus", focus);
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
    maxZoom: 16.8,
    maxPitch: 60,
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
      city: selected,
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
    if (detailLevel(map.getZoom()) === "map") setStatus("map");
    updatePlaceLabel();
  });
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
      ? "WebGL 2 is unavailable. Enable hardware acceleration or open the original 2D version."
      : "無法使用 WebGL 2。請開啟硬體加速，或使用原版 2D。";
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
    zoom: mobile ? 14.9 : 15.2,
    pitch: 36,
    bearing: id === "shanghai" ? -8 : 0,
    duration: 1000,
  };
  map.stop();
  if (
    Math.hypot(...localPoint(...camera.center, map.getCenter().toArray())) >
    50000
  )
    map.jumpTo(camera);
  else map.flyTo(camera);
  if (mobile) togglePanel(null);
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
        clamp(
          { "road-halo": 0.2, "road-glow": 0.36, "road-rim": 0.72 }[id] *
            layer.glow,
          0,
          1,
        ),
      );
  map?.triggerRepaint();
};
$("density").value = String(layer.density);
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
        selected = place.name;
        $("city-title").textContent = place.name;
        stream?.setCity(null);
        map.flyTo({ center: place.center, zoom: 15.2, pitch: 48 });
        togglePanel(null);
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
    lng: p.lng.toFixed(6),
    lat: p.lat.toFixed(6),
    zoom: map.getZoom().toFixed(3),
    pitch: map.getPitch().toFixed(2),
    bearing: map.getBearing().toFixed(2),
    glow: layer.glow,
    density: layer.density,
    lang: locale,
  };
  for (const [k, v] of Object.entries(recipe))
    url.searchParams.set(k, String(v));
  if (embed) url.searchParams.set("embed", "1");
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
  $("resolution").disabled = $("format").value === "gif";
};
$("format").onchange();
$("save").onclick = async () => {
  if (capturing || !stream || (!layer.mesh && map.getZoom() >= 14.1)) {
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
    const result = await exportNight({
      map,
      layer,
      stream,
      format: $("format").value,
      longEdge: Number($("resolution").value),
      duration: Number($("duration").value),
      signal: exportAbort.signal,
      progress: (value) => (progress.value = value),
    });
    download(
      result.blob,
      `lumen-streets-3d.${result.extension}`,
      result.release,
    );
  } catch (error) {
    if (!exportAbort.signal.aborted)
      notify(`${t("captureError")} ${error.message}`);
  } finally {
    capturing = false;
    $("export-progress").hidden = true;
    document.body.classList.remove("capturing");
  }
};
$("cancel-export").onclick = () => exportAbort?.abort();
$("model-file").onchange = (e) => {
  modelFile = e.target.files[0];
};
$("place-model").onclick = async () => {
  if (!modelFile || !$("model-author").value.trim()) {
    notify(t("modelRequired"));
    return;
  }
  const generation = ++modelGeneration;
  try {
    if (modelFile.size > MODEL_LIMITS.bytes)
      throw Error("Maximum GLB size: 8 MB.");
    const buffer = await modelFile.arrayBuffer(),
      anchor = map.getCenter().toArray(),
      height = Number($("model-height").value),
      bearing = Number($("model-bearing").value);
    const object = await importModel(buffer, { anchor, height, bearing });
    if (generation !== modelGeneration) {
      layer.disposeObject(object);
      return;
    }
    if (modelObject) {
      layer.uploads.remove(modelObject);
      layer.disposeObject(modelObject);
    }
    modelObject = object;
    layer.uploads.add(object);
    layer.updateUploads();
    map.triggerRepaint();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    manifest = {
      version: 1,
      format: "glb",
      file: modelFile.name,
      sha256: [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      anchor,
      height,
      bearing,
      creator: $("model-author").value.trim(),
      license: $("model-license").value,
      triangles: object.userData.triangles,
    };
    $("remove-model").disabled = $("model-manifest").disabled = false;
    notify(t(map.getZoom() < 14.1 ? "modelOnly" : "modelPlaced"));
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
  }
  $("remove-model").disabled = $("model-manifest").disabled = true;
  map.triggerRepaint();
};
$("model-manifest").onclick = () => {
  if (manifest)
    download(
      new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json",
      }),
      "landmark.json",
    );
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
    if (orbit && !map.isMoving()) {
      map.jumpTo({ bearing: map.getBearing() + 0.035 });
    }
    if (
      layer.playing &&
      (layer.density > 0 || layer.routes.length > 0) &&
      map.getZoom() >= 14.8
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
