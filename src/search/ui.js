import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { t, locale, applyLocale } from "../i18n.js";
import { selection } from "./area.js";
import { geocoder, mapDataSource } from "./providers.ts";
import { mapErrorText } from "./errors.js";
export function initSearch(load) {
  const $ = id => document.getElementById(id), dialog = $("search-dialog");
  let map, square, controller, selected, size = 2, results = [];
  const center = () => { const c = map.getCenter(); return [c.lng, c.lat]; };
  function updateArea() {
    if (!map || !selected) return;
    try {
      const area = selection({ center: center(), size });
      square.setBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]]);
      $("area-coordinates").textContent = `${area.center[1].toFixed(5)}, ${area.center[0].toFixed(5)} · ${size} × ${size} km`;
      $("generate-area").disabled = false;
    } catch {
      $("area-coordinates").textContent = t("invalidArea");
      $("generate-area").disabled = true;
    }
  }
  function showArea(result) {
    selected = result;
    $("selected-place").textContent = result.name;
    $("selected-context").textContent = result.context;
    $("area-section").hidden = false;
    $("search-stage").hidden = true;
    if (!map) {
      map = L.map("area-map", { zoomControl: false, minZoom: 11, maxZoom: 17, maxBounds: [[-80, -180], [80, 180]], maxBoundsViscosity: 1 });
      L.control.zoom({ position: "topright", zoomInTitle: t("zoomIn"), zoomOutTitle: t("zoomOut") }).addTo(map);
      L.tileLayer(import.meta.env.VITE_LUMEN_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, noWrap: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      }).on("tileerror", () => { $("tile-message").hidden = false; }).addTo(map);
      square = L.rectangle([[0, 0], [0, 0]], { color: "#bc7725", weight: 2, fillColor: "#daa453", fillOpacity: 0.12, interactive: false }).addTo(map);
      map.attributionControl.setPrefix(false);
      map.on("move", updateArea);
    }
    map.invalidateSize();
    map.setView([result.center[1], result.center[0]], 14, { animate: false });
    updateArea();
    dialog.scrollTop = 0;
    $("area-map").focus();
  }
  function renderResults() {
    $("search-results").replaceChildren();
    for (const result of results) {
      const item = document.createElement("li"), button = document.createElement("button");
      const name = document.createElement("strong"), detail = document.createElement("span");
      name.textContent = result.name;
      detail.textContent = result.context;
      button.append(name, detail); button.onclick = () => showArea(result);
      item.append(button); $("search-results").append(item);
    }
  }
  $("search-form").onsubmit = async event => {
    event.preventDefault(); controller?.abort();
    const current = new AbortController(); controller = current;
    $("search-message").textContent = t("searching");
    $("cancel-search").hidden = false;
    results = []; renderResults();
    selected = undefined; $("area-section").hidden = true;
    try {
      results = await geocoder.search($("place-query").value, locale, current.signal);
      if (controller !== current) return;
      renderResults();
      $("search-message").textContent = t(results.length ? "chooseResult" : "noResults");
    } catch (error) {
      if (controller === current) $("search-message").textContent = current.signal.aborted ? t("cancelled") : mapErrorText(error);
    } finally { if (controller === current) $("cancel-search").hidden = true; }
  };
  $("cancel-search").onclick = () => controller?.abort();
  $("change-place").onclick = () => { $("area-section").hidden = true; $("search-stage").hidden = false; $("place-query").focus(); };
  $("close-search").onclick = () => dialog.close();
  dialog.addEventListener("close", () => controller?.abort());
  $("find-place").onclick = () => { applyLocale(); dialog.showModal(); map?.invalidateSize(); updateArea(); $("place-query").focus(); };
  for (const b of dialog.querySelectorAll("[data-area-size]")) b.onclick = () => {
    size = Number(b.dataset.areaSize);
    for (const other of dialog.querySelectorAll("[data-area-size]")) other.setAttribute("aria-pressed", String(other === b));
    if (map && selected) {
      updateArea();
      map.fitBounds(square.getBounds(), { padding: [30, 30], animate: false });
    }
  };
  $("generate-area").onclick = () => {
    if (!selected) return;
    const area = selection({ center: center(), size }), name = selected.name;
    dialog.close();
    load((signal, progress) => mapDataSource.load(area, name, signal, progress));
  };
  addEventListener("pagehide", () => { controller?.abort(); map?.remove(); });
}
