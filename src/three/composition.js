import { Vector4 } from "three";
import { localPoint } from "./geo.js";
import { paintPlaceTitle } from "../export/png.ts";

export const ASPECTS = {
  "16:9": 16 / 9,
  "16:10": 1.6,
  "21:9": 21 / 9,
  "32:9": 32 / 9,
  "4:3": 4 / 3,
  "3:2": 1.5,
  "1:1": 1,
  "4:5": 0.8,
  "9:16": 9 / 16,
  "3:4": 0.75,
  "2:3": 2 / 3,
  "9:18": 0.5,
  "9:19.5": 9 / 19.5,
  "9:20": 0.45,
  "9:21": 9 / 21,
};
export function captureSize(aspect, longEdge, format) {
  if (!Number.isFinite(aspect) || aspect < 0.25 || aspect > 4)
    throw Error("Invalid aspect ratio");
  if (!Number.isFinite(longEdge) || longEdge < 128)
    throw Error("Invalid output size");
  const edge = Math.min(
    longEdge,
    format === "gif" ? 720 : format === "video" ? 2560 : 3840,
  );
  const unit = format === "video" ? 2 : 1;
  return [
    aspect >= 1 ? edge : edge * aspect,
    aspect >= 1 ? edge / aspect : edge,
  ].map((n) => Math.max(2, Math.round(n / unit) * unit));
}

export const landmarkNames = {
  "taipei-101": ["Taipei 101", "台北 101"],
  "sapporo-tv-tower": ["Sapporo TV Tower", "札幌電視塔"],
  "oriental-pearl": ["Oriental Pearl", "東方明珠"],
  "shanghai-tower": ["Shanghai Tower", "上海中心大廈"],
  "shanghai-wfc": ["Shanghai World Financial Center", "上海環球金融中心"],
  "jin-mao": ["Jin Mao Tower", "金茂大廈"],
};
export function labelFontText(layer, locale) {
  return [
    ...(layer?.landmarks || []).map(
      (p) =>
        landmarkNames[p.id]?.[locale === "zh-TW" ? 1 : 0] ||
        p.names?.[locale] ||
        p.name ||
        "",
    ),
    ...(layer?.uploads?.children || []).map((m) => m.userData.name || ""),
  ].join(" ");
}

function paintLabels(ctx, width, height, layer, locale, minSize = 9) {
  if (!layer?.mesh?.visible) return;
  const size = Math.max(minSize, Math.min(width, height) / 75),
    padding = size * 0.7,
    occupied = [];
  ctx.save();
  ctx.font = `500 ${size}px "Cormorant Garamond", "Noto Serif TC", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const landmarks = [
    ...(layer.landmarks || []),
    ...(layer.uploads?.children || []).map((m) => m.userData),
  ].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const landmark of landmarks) {
    const name =
      landmarkNames[landmark.id]?.[locale === "zh-TW" ? 1 : 0] ||
      landmark.names?.[locale] ||
      landmark.name;
    if (!name) continue;
    const [x, y] = localPoint(...landmark.anchor, layer.origin);
    const p = new Vector4(x, y, landmark.height, 1).applyMatrix4(
      layer.camera.projectionMatrix,
    );
    if (p.w <= 0 || p.z / p.w < -1 || p.z / p.w > 1) continue;
    const sx = ((p.x / p.w + 1) * width) / 2,
      sy = ((1 - p.y / p.w) * height) / 2;
    const half = ctx.measureText(name).width / 2 + padding,
      top = sy - size * 3;
    if (
      sx - half < padding ||
      sx + half > width - padding ||
      top < padding ||
      sy > height - size * 5
    )
      continue;
    const box = [sx - half, top - size, sx + half, sy];
    if (
      occupied.some(
        (b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
      )
    )
      continue;
    occupied.push(box);
    ctx.shadowColor = "#02090b";
    ctx.shadowBlur = size * 0.8;
    ctx.fillStyle = "#dbd9ce";
    ctx.fillText(name, sx, top + size);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#cab787a0";
    ctx.lineWidth = Math.max(0.7, size / 16);
    ctx.beginPath();
    ctx.moveTo(sx, top + size * 1.4);
    ctx.lineTo(sx, sy - size * 0.3);
    ctx.stroke();
    if (occupied.length >= (width / height < 0.8 ? 5 : 9)) break;
  }
  ctx.restore();
}

/** Identical composition for the live frame and every output format. */
export function paintComposition(ctx, width, height, options = {}, layer) {
  ctx.save();
  const { edge = "none", brightness = 45, area = 60 } = options.quiet || {};
  if (["left", "right", "top", "bottom"].includes(edge)) {
    const horizontal = edge === "left" || edge === "right",
      reverse = edge === "right" || edge === "bottom";
    const axis = horizontal ? width : height,
      start = reverse ? axis : 0;
    const extent = axis * Math.max(0.01, Math.min(1, area / 100)),
      end = start + (reverse ? -extent : extent);
    const gradient = horizontal
      ? ctx.createLinearGradient(start, 0, end, 0)
      : ctx.createLinearGradient(0, start, 0, end);
    const strength = 1 - Math.max(0, Math.min(1, brightness / 100));
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      gradient.addColorStop(
        t,
        `rgba(0,0,0,${strength * (1 - t * t * (3 - 2 * t))})`,
      );
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (options.landmarkLabels)
    paintLabels(
      ctx,
      width,
      height,
      layer,
      options.locale,
      options.labelMinSize,
    );
  if (options.placeTitle?.text)
    paintPlaceTitle(ctx, width, height, options.placeTitle, height);
  if (layer?.heightAttribution?.length) {
    // Prepared datasets travel with every PNG/GIF/video frame, even when the
    // host UI is not present. Source text is data, never HTML.
    const size = Math.max(9, Math.min(width, height) / 100), gap = size * 1.35;
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const credits = layer.heightAttribution.some(s => /OpenStreetMap/.test(s)) ? layer.heightAttribution :
      ["© OpenStreetMap contributors", ...layer.heightAttribution];
    const lines = [], words = credits.join(" · ").split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && ctx.measureText(`${line} ${word}`).width > width - 24) { lines.push(line); line = ""; }
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    ctx.fillStyle = "#081017cc";
    ctx.fillRect(0, height - lines.length * gap - 10, width, lines.length * gap + 10);
    ctx.fillStyle = "#b7c0bf";
    lines.forEach((text, i) => ctx.fillText(text, 12, height - 5 - (lines.length - 1 - i) * gap));
  }
  ctx.restore();
}
