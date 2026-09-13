import { ensureTitleFonts } from "./title-fonts.ts";
import { exportPNG, encodeCapturePNG, paintCapture } from "./png.ts";
import { encodeCaptureGIF } from "./gif.ts";
import { wallpaperPlan, videoSeconds, screenDimensions } from "./framing.ts";
import { t } from "../i18n.js";

/** The host owns captures, jobs and result URLs; the editor is never used for encoding. */
export function createExportUI(getSource, toast) {
  const $ = id => document.getElementById(id);
  let controller, preview, source, blobURL, posterURL, creditURL, resultRelease, isGIF = false, revision = 0, drag;
  const video = format => format === "mp4" || format === "webm";
  const displaySize = () => screenDimensions(globalThis.screen, globalThis.devicePixelRatio);
  const title = s => `Lumen Streets · ${s.name} · ${t(s.palette)}`;
  let videoModule, titlePlace;
  const loadVideo = () => videoModule ??= import("./video.ts").catch(error => { videoModule = undefined; throw error; });
  const capabilities = new Map();
  async function supported(format, width, height) {
    const key = `${format}:${width}:${height}`;
    if (!capabilities.has(key)) capabilities.set(key, loadVideo().then(m => m.supportsVideo(format, width, height)));
    try { return await capabilities.get(key); } catch { capabilities.delete(key); return false; }
  }
  function releaseResult() {
    const player = $("export-video"); player.pause(); player.removeAttribute("src"); player.removeAttribute("poster"); player.load();
    $("export-image").removeAttribute("src"); $("export-download").removeAttribute("href"); $("export-credits").removeAttribute("href");
    for (const url of [blobURL, posterURL, creditURL]) if (url) URL.revokeObjectURL(url);
    resultRelease?.(); resultRelease = undefined;
    blobURL = posterURL = creditURL = undefined; isGIF = false;
  }
  function releasePreview() {
    revision++; preview?.dispose(); preview = source = drag = undefined;
    $("capture-preview").width = $("capture-preview").height = 0;
  }
  function showResult(result, s, suffix, format) {
    releaseResult(); isGIF = format === "gif";
    const blob = result.blob ?? result, isVideo = video(format);
    resultRelease = result.release;
    const name = `lumen-streets-${s.engine.data.id}${suffix}-${s.palette}`;
    blobURL = URL.createObjectURL(blob);
    if (result.poster) posterURL = URL.createObjectURL(result.poster);
    const credit = `${title(s)}\n${s.engine.data.source.attribution}\nhttps://www.openstreetmap.org/copyright\nSource fingerprint: ${s.engine.data.fingerprint}\n\n${t("creditSharing")}\n`;
    creditURL = URL.createObjectURL(new Blob([credit], { type: "text/plain;charset=utf-8" }));
    $("export-credits").href = creditURL; $("export-credits").download = `${name}-credits.txt`;
    $("export-source").textContent = s.engine.data.source.attribution;
    $("export-image").hidden = isVideo; $("export-video").hidden = !isVideo;
    if (isVideo) { $("export-video").src = blobURL; $("export-video").poster = posterURL; }
    else $("export-image").src = posterURL || blobURL;
    const study = suffix === "-study";
    $("export-image").alt = t(study ? "areaAlt" : "imageAlt", { name: s.name });
    $("export-title").textContent = study ? t("areaTitle", { name: s.name }) : s.name + " · " + t(s.palette);
    $("export-download").href = blobURL; $("export-download").download = `${name}.${format}`;
    $("export-download").textContent = t(isVideo ? "downloadVideo" : isGIF ? "downloadGIF" : "download");
    $("export-note").textContent = `${format.toUpperCase()} · ${(blob.size / 1e6).toFixed(1)} MB`;
    $("gif-preview-toggle").hidden = !isGIF;
    $("gif-preview-toggle").textContent = t("playPreview"); $("gif-preview-toggle").setAttribute("aria-pressed", "false");
    $("export-platform-help").hidden = !isVideo;
    $("wallpaper-guide").href = `./wallpapers.html${s.view.locale === "zh-TW" ? "#zh" : ""}`;
    $("export-dialog").showModal();
  }
  async function run(s, suffix, format, work, owned) {
    controller?.abort(); const current = new AbortController(); controller = current;
    $("export-progress").hidden = false;
    $("save-study").disabled = $("export-options").disabled = true;
    const progress = fraction => {
      if (controller !== current) return;
      $("export-meter").value = fraction;
      $("export-progress-text").textContent = t("exporting", { percent: Math.floor(fraction * 100) });
    };
    progress(0);
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      current.signal.throwIfAborted();
      const result = await work(current.signal, progress);
      if (current.signal.aborted || controller !== current) { await result.release?.(); return; }
      showResult(result, s, suffix, format);
    } catch (error) {
      if (controller === current && !current.signal.aborted) {
        if (import.meta.env.DEV) console.error("Export failed", error);
        const key = { GIF_TOO_LARGE: "gifTooLarge", VIDEO_TOO_LARGE: "videoTooLarge", VIDEO_UNSUPPORTED: "videoUnsupported", VIDEO_TIMEOUT: "videoTimeout", VIDEO_STORAGE_UNAVAILABLE: "videoStorage", TITLE_FONT_UNAVAILABLE: "titleFontError" }[error.message];
        toast(t(key ?? "exportError"));
      }
    } finally {
      owned?.dispose();
      if (controller === current) {
        controller = undefined; $("export-progress").hidden = true;
        $("save-study").disabled = $("export-options").disabled = false;
      }
    }
  }
  function planFor(s, size, format) {
    const plan = wallpaperPlan(s.view, s.engine.data.geometry.bounds, s.camera, size, format, Number($('capture-resolution').value), s.screen);
    plan.view.labels = $('capture-labels').checked;
    return plan;
  }
  const secondsValue = () => videoSeconds(Number($('capture-duration').value === 'custom' ? $('capture-seconds').value : $('capture-duration').value));
  const placeTitle = () => $('capture-place-title').checked ? { text: $('capture-title-text').value, corner: $('capture-title-corner').value, size: $('capture-title-size').value } : undefined;
  const quietSpace = () => ({ edge: $('capture-quiet-edge').value, strength: Number($('capture-quiet-strength').value)/100 });
  async function updatePreview() {
    if (!preview || !source) return;
    const version = ++revision;
    try {
      const format = $("capture-format").value, size = $("capture-size").value, isVideo = video(format);
      $('video-settings').hidden = $('video-estimate').hidden = !isVideo;
      $('capture-resolution').options[0].textContent = size === 'desktop1610' ? '1920 × 1200' : '1080p';
      $('capture-resolution').options[1].textContent = size === 'desktop1610' ? '2560 × 1600' : '1440p';
      $('create-export').disabled = true;
      const overlay = placeTitle();
      try { await ensureTitleFonts(overlay?.text); } catch { if (version === revision) $('video-support').textContent = t('titleFontError'); return; }
      if (version !== revision || !preview || !source) return;
      $('custom-duration-control').hidden = $('capture-duration').value !== 'custom';
      $('place-title-controls').hidden = !$('capture-place-title').checked;
      $('quiet-strength-control').hidden = $('capture-quiet-edge').value === 'none';
      $('quiet-strength-value').textContent = `${$('capture-quiet-strength').value}%`;
      const plan = planFor(source, size, format); preview.setCamera(plan.camera);
      const scale = Math.min(520 / plan.width, 280 / plan.height, 1);
      const canvas = $("capture-preview"); canvas.width = Math.round(plan.width * scale); canvas.height = Math.round(plan.height * scale);
      paintCapture(preview, canvas, { ...plan, title: title(source), includeCredit: $("capture-credit").checked, placeTitle: overlay, quietSpace: quietSpace() }, scale);
      $("capture-dimensions").textContent = `${plan.width} × ${plan.height} ${format.toUpperCase()}`;
      $("gif-details").hidden = format !== "gif"; $("video-details").hidden = !isVideo;
      $("duration-control").hidden = !isVideo;
      $("create-export").textContent = t(isVideo ? "createVideo" : format === "gif" ? "createGIF" : "createPNG");
      $("create-export").disabled = isVideo;
      $("video-support").textContent = isVideo ? t("checkingVideo") : "";
      if (isVideo) {
        let seconds;
        try { seconds = secondsValue(); } catch { $('video-support').textContent = t('invalidDuration'); $('video-estimate').textContent = ''; return; }
        const module = await loadVideo(); if (version !== revision) return;
        $('video-estimate').textContent = t('videoEstimate', { size: Math.round(module.videoBitrate(plan.width,plan.height) * seconds / 8e6) });
        const storageAvailable = await module.videoStorageAvailable(seconds > 60 || Math.max(plan.width,plan.height) > 1920, module.videoBitrate(plan.width,plan.height) * seconds / 8);
        if (version !== revision) return;
        if (!storageAvailable) { $('video-support').textContent = t('videoStorage'); return; }
        const available = await supported(format, plan.width, plan.height);
        if (version !== revision) return;
        $("create-export").disabled = !available;
        $("video-support").textContent = available ? "" : t("videoUnsupported");
      }
    } catch { if (version === revision) { $("create-export").disabled = true; $("capture-dimensions").textContent = t("exportError"); } }
  }
  function open() {
    if (controller) return;
    const next = getSource(); if (!next) return;
    releasePreview();
    try {
      source = { ...next, view: structuredClone(next.view), camera: next.engine.camera, screen: displaySize() };
      if (titlePlace !== next.engine.data.id) { $('capture-title-text').value = next.name.slice(0,120); titlePlace = next.engine.data.id; }
      $('adjust-panel').hidden = true; $('adjust').setAttribute('aria-expanded','false');
      preview = next.engine.fork(); $("capture-dialog").showModal(); updatePreview();
    } catch { releasePreview(); toast(t("exportError")); }
  }
  function cancel() { controller?.abort(); if ($("capture-dialog").open) $("capture-dialog").close(); releasePreview(); }
  $("export-options").onclick = open;
  const refreshScreen = () => {
    if (!source || !preview) return;
    const next = displaySize();
    if (next?.width === source.screen?.width && next?.height === source.screen?.height) return;
    source.screen = next;
    if ($('capture-size').value === 'current') updatePreview();
  };
  globalThis.addEventListener('resize', refreshScreen);
  globalThis.screen?.orientation?.addEventListener?.('change', refreshScreen);
  for (const id of ["capture-format", "capture-size", "capture-credit", 'capture-resolution', 'capture-duration', 'capture-labels', 'capture-place-title', 'capture-title-corner', 'capture-title-size', 'capture-quiet-edge']) $(id).onchange = updatePreview;
  $('capture-quiet-strength').oninput = updatePreview;
  $('capture-title-text').oninput = updatePreview;
  $('capture-seconds').oninput = updatePreview;
  $("close-capture").onclick = () => $("capture-dialog").close();
  $("capture-dialog").addEventListener("close", releasePreview);
  $("capture-preview").onpointerdown = event => {
    if (!preview) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, camera: preview.camera };
  };
  $("capture-preview").onpointermove = event => {
    if (!drag || !source) return;
    const rect = event.currentTarget.getBoundingClientRect(), plan = planFor(source, $("capture-size").value, $("capture-format").value);
    const scale = rect.width / plan.view.width * drag.camera.zoom;
    source.camera = { ...drag.camera, x: drag.camera.x - (event.clientX - drag.x) / scale, y: drag.camera.y - (event.clientY - drag.y) / scale };
    updatePreview();
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("capture-preview").addEventListener(event, () => { drag = undefined; });
  $("capture-preview").onkeydown = event => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!d || !preview) return; event.preventDefault(); const camera = preview.camera;
    source.camera = { ...camera, x: camera.x + d[0] * 60 / camera.zoom, y: camera.y + d[1] * 60 / camera.zoom }; updatePreview();
  };
  for (const [id, factor] of [["crop-in", 1.2], ["crop-out", 1 / 1.2]]) $(id).onclick = () => {
    if (!preview) return; source.camera = { ...preview.camera, zoom: Math.min(10, preview.camera.zoom * factor) }; updatePreview();
  };
  $("create-export").onclick = () => {
    if (!preview || !source || $("create-export").disabled) return;
    const owned = preview, s = source, format = $("capture-format").value, size = $("capture-size").value;
    let seconds; try { seconds = video(format) ? secondsValue() : 0; } catch { updatePreview(); return; }
    const plan = planFor(s, size, format), captureTitle = title(s), includeCredit = $("capture-credit").checked, overlay = placeTitle(), quiet = quietSpace();
    owned.setCamera(plan.camera); preview = source = undefined; $("capture-dialog").close();
    run(s, `-${size}${video(format) ? `-${seconds}s` : ""}`, format, async (signal, onProgress) => {
      const options = { ...plan, title: captureTitle, signal, onProgress, includeCredit, placeTitle: overlay, quietSpace: quiet };
      if (video(format)) return (await loadVideo()).encodeCaptureVideo(owned, { ...options, format, seconds });
      return format === "gif" ? encodeCaptureGIF(owned, options) : encodeCapturePNG(owned, { ...options, mode: "view" });
    }, owned);
  };
  $("cancel-export").onclick = () => { controller?.abort(); toast(t("exportCancelled")); };
  $("close-export").onclick = () => $("export-dialog").close(); $("export-dialog").addEventListener("close", releaseResult);
  $("gif-preview-toggle").onclick = () => {
    if (!isGIF) return; const play = $("gif-preview-toggle").getAttribute("aria-pressed") !== "true";
    $("export-image").src = play ? blobURL : posterURL; $("gif-preview-toggle").setAttribute("aria-pressed", String(play)); $("gif-preview-toggle").textContent = t(play ? "pausePreview" : "playPreview");
  };
  document.addEventListener("keydown", event => { if (event.key === "Escape" && controller) { event.preventDefault(); controller.abort(); } });
  return {
    open, cancel,
    savePNG(mode) {
      const next = getSource(); if (!next) return;
      const s = { ...next, view: structuredClone(next.view), camera: next.engine.camera, screen: displaySize() };
      if ($("notes").open) $("notes").close();
      if (mode === "study") return run(s, "-study", "png", (signal, onProgress) => exportPNG(s.engine, { mode, width: 1600, height: 1600, view: s.view, title: title(s), signal, onProgress }));
      const owned = next.engine.fork(), plan = planFor(s, "current", "png"); owned.setCamera(plan.camera);
      return run(s, "", "png", (signal, onProgress) => encodeCapturePNG(owned, { ...plan, mode: "view", title: title(s), signal, onProgress }), owned);
    },
    dispose() { cancel(); releaseResult(); },
  };
}
