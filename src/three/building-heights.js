// The 3D boundary distinguishes measurements, estimates and lossy upstream
// rendering values. Legacy scene normalization remains immutable.
const methods = new Set(["survey", "mapped", "levels", "model", "raster", "regional", "fallback"]);
const definitions = new Set(["ground_to_top", "ground_to_roof", "roof_mean", "roof_unspecified", "cell_mean"]);
const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1200;
export function tileHeight(properties = {}) {
  const p = properties;
  if (p.lumen_height_version !== undefined) {
    if (p.lumen_height_version !== 1 || !positive(p.height_m) ||
        !Number.isFinite(p.min_height_m) || p.min_height_m < 0 || p.min_height_m >= p.height_m ||
        !methods.has(p.height_method) || typeof p.height_source !== "string" ||
        !definitions.has(p.height_definition) || typeof p.height_missing !== "boolean" ||
        !Number.isFinite(p.height_match) || p.height_match < .65 || p.height_match > 1 ||
        typeof p.height_estimated !== "boolean" ||
        p.height_estimated !== !["survey", "mapped"].includes(p.height_method))
      throw Error("Invalid prepared building height");
    return { top: p.height_m, bottom: p.min_height_m, source: p.height_source,
      method: p.height_method, estimated: p.height_estimated, raw: p.height_raw ?? null,
      floors: p.floors_raw ?? null, missing: p.height_missing,
      definition: p.height_definition, year: p.height_year ?? null,
      match: p.height_match, conflict: p.height_conflict === true };
  }
  const h = Number(p.render_height), min = Number(p.render_min_height);
  if (positive(h)) return { top: h, bottom: Number.isFinite(min) && min >= 0 && min < h ? min : 0,
    source: "openmaptiles:render_height", method: "upstream-unknown", estimated: null,
    raw: null, floors: null, missing: null, definition: "unknown", year: null };
  return null;
}

export function renderedHeight(properties) {
  return tileHeight(properties)?.top ?? 8;
}
