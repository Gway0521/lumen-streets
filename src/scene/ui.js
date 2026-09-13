import { sceneFile, readSceneFile, sceneReference, encodeReference, SceneFileError } from "./portable.ts";
import { t, locale } from "../i18n.js";

export function createSceneUI(getSource, loadScene, toast) {
  const $ = id => document.getElementById(id); let url;
  const release = () => { if (url) URL.revokeObjectURL(url); url = undefined; $("download-scene").removeAttribute("href"); };
  $("share-scene").onclick = () => {
    const source = getSource(); if (!source) return;
    release();
    try {
      const { engine, view } = source, recipe = engine.snapshot(), blob = sceneFile(engine.data, recipe, view);
      url = URL.createObjectURL(blob); $("download-scene").href = url; $("download-scene").download = `lumen-${engine.data.id}.lumen.json`;
      $("scene-file-size").textContent = `${(blob.size / 1e6).toFixed(1)} MB`;
      const ref = sceneReference(engine.data, recipe, view);
      $("reference-fields").hidden = !ref; $("custom-sharing").hidden = !!ref;
      $("local-sharing").hidden = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
      if (ref) {
        const link = new URL(`${import.meta.env.BASE_URL}player.html`, location.href); link.searchParams.set("lang", locale); link.hash = `scene=${encodeReference(ref)}`;
        $("scene-link").value = link.href; $("open-player").href = link.href;
        const escaped = link.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        $("scene-embed").value = `<iframe src="${escaped}" title="Lumen Streets" width="960" height="540" loading="lazy" style="border:0;width:100%;aspect-ratio:16/9;height:auto"></iframe>`;
      }
      $("scene-guide").href = `./scenes.html${locale === "zh-TW" ? "#zh" : ""}`;
      $("scene-dialog").showModal();
    } catch (error) { release(); toast(t(error instanceof SceneFileError ? error.code : "sceneInvalid")); }
  };
  $("close-scene").onclick = () => $("scene-dialog").close();
  $("scene-dialog").addEventListener("close", release);
  for (const [button, field] of [["copy-link", "scene-link"], ["copy-embed", "scene-embed"]]) $(button).onclick = async () => {
    try { await navigator.clipboard.writeText($(field).value); toast(t("copied")); }
    catch { $(field).focus(); $(field).select(); toast(t("copyManually")); }
  };
  $("open-scene").onclick = () => $("import-scene").click();
  $("import-scene").onchange = () => {
    const file = $("import-scene").files[0]; $("import-scene").value = "";
    if (file) loadScene(signal => readSceneFile(file, signal));
  };
  return { close() { $("scene-dialog").close(); release(); }, dispose: release };
}
