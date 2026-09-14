import { SceneEngine } from "../engine/scene-engine.ts";
import { readSceneFile, decodeReference, resolveReference, fetchSceneFile, SceneFileError } from "../scene/portable.ts";
import { wallpaperPlan, cropView } from "../export/framing.ts";
import { Playback } from "./playback.ts";
import { t, locale, placeName, applyLocale, setLocale } from "../i18n.js";
import "./style.css";
const $ = id => document.getElementById(id), canvas = $("scene"), ctx = canvas.getContext("2d", { alpha: false });
const playback = new Playback(), motion = matchMedia("(prefers-reduced-motion: reduce)");
let engine, held, controller, retry, raf = 0, messageKey = "playerEmpty";
document.body.classList.toggle("embedded", window.self !== window.top);
applyLocale();
function text() {
  $("play").textContent = t(playback.desired ? "pause" : "resume"); $("play").setAttribute("aria-pressed", String(playback.desired));
  if (held) { $("scene-name").textContent = placeName(held.data.geometry); canvas.setAttribute("aria-label", t("canvas", { name: placeName(held.data.geometry) })); }
  document.title = `Lumen Streets · ${t("playerLabel")}`;
  $("player-status").textContent = t(messageKey);
}
function draw() {
  if (!engine || !held) return;
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 1.8, 4096 / Math.max(box.width, box.height), Math.sqrt(8_000_000 / (box.width * box.height)));
  const width = Math.max(128, Math.round(box.width * dpr)), height = Math.max(128, Math.round(box.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const view = cropView({ ...held.view, origin: [held.view.width / 2, held.view.height / 2] }, width, height);
  const plan = wallpaperPlan(view, held.data.geometry.bounds, held.recipe.camera, "current", "png",1080,undefined,engine.projection);
  engine.setCamera(plan.camera); engine.render(ctx, { ...plan.view, labels: held.recipe.appearance?.labels ?? false, locale });
}
function frame(now) {
  raf = 0; if (!engine || !playback.running) return;
  engine.advance(playback.tick(now)); draw(); raf = requestAnimationFrame(frame);
}
function schedule() {
  cancelAnimationFrame(raf); raf = 0; playback.reset(); text();
  if (engine && playback.running) raf = requestAnimationFrame(frame);
}
const intersection = new IntersectionObserver(entries => { playback.intersecting = entries[0].isIntersecting && entries[0].intersectionRatio > 0; schedule(); }, { threshold: 0 });
intersection.observe(canvas);
document.addEventListener("visibilitychange", () => { playback.visible = !document.hidden; schedule(); });
motion.addEventListener("change", () => { if (motion.matches) playback.desired = false; schedule(); });
const resizer = new ResizeObserver(draw); resizer.observe($("player"));
$("play").onclick = () => { playback.desired = !playback.desired; schedule(); };
async function load(loader) {
  controller?.abort(); const current = new AbortController(); controller = current; retry = loader;
  const timer = setTimeout(() => current.abort(new Error("timeout")), 30000);
  messageKey = "openingScene"; $("player-message").hidden = false; text(); $("cancel-load").hidden = false; $("retry-load").hidden = true;
  try {
    const next = await loader(current.signal); current.signal.throwIfAborted();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); current.signal.throwIfAborted();
    const replacement = new SceneEngine(next.data, next.recipe);
    engine?.dispose(); engine = replacement; held = next;
    playback.desired = next.recipe.playing && !motion.matches;
    $("source-credit").textContent = next.data.source.attribution; $("play").disabled = false;
    $("player-message").hidden = true; draw(); schedule();
  } catch (error) {
    if (controller !== current) return;
    messageKey = current.signal.aborted ? "sceneCancelled" : error instanceof SceneFileError ? error.code : "sceneInvalid"; text();
    $("retry-load").hidden = false;
  } finally { clearTimeout(timer); if (controller === current) { controller = undefined; $("cancel-load").hidden = true; } }
}
$("cancel-load").onclick = () => controller?.abort();
$("retry-load").onclick = () => retry && load(retry);
$("open-file").onclick = $("replace-file").onclick = () => $("scene-file").click();
$("scene-file").onchange = () => { const file = $("scene-file").files[0]; $("scene-file").value = ""; if (file) load(signal => readSceneFile(file, signal)); };
$("language").onclick = () => { setLocale(locale === "en" ? "zh-TW" : "en"); const url = new URL(location.href); url.searchParams.set("lang", locale); history.replaceState(null, "", url); applyLocale(); text(); draw(); };
function fromURL() {
  const path = new URLSearchParams(location.search).get("scene"), hash = location.hash;
  if (path) load(signal => fetchSceneFile(path, location.href, signal));
  else if (hash) load(signal => resolveReference(decodeReference(hash.startsWith("#scene=") ? hash.slice(7) : ""), signal));
  else { controller?.abort(); text(); }
}
addEventListener("hashchange", fromURL);
addEventListener("pagehide", event => { controller?.abort(); playback.visible = false; schedule(); if (!event.persisted) { intersection.disconnect(); resizer.disconnect(); engine?.dispose(); } });
addEventListener("pageshow", () => { playback.visible = !document.hidden; schedule(); });
text(); fromURL();
