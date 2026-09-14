import { sample, green } from "../traffic.js";
import { drawRail } from "../rail.js";
import { layoutLandmarkLabels } from "../landmarks.js";

export function createFramePainter() {
  let supportsFilter;
  let shadedForeground, foregroundSource, foregroundBrightness;
  const warmGlow = makeGlow("#ffd5a0"),
    redGlow = makeGlow("#f06b45");
  return {
    render(ctx, state, view) {
      const { city, atlas, traffic, camera, mood, trains, xray } = state;
      const {
        width,
        height,
        dpr = 1,
        quietMode = false,
        locale = "en",
        labels = true,
        vignette = true,
      } = view;
      const origin = () =>
        view.origin ?? [
          width * (width > 760 && !quietMode ? 0.63 : 0.5),
          height * 0.5,
        ];
      function paintTraffic(c) {
        if (!traffic) return;
        for (const n of traffic.graph.signals) {
          if (
            n.p[0] < city.bounds[0] ||
            n.p[0] > city.bounds[2] ||
            n.p[1] < city.bounds[1] ||
            n.p[1] > city.bounds[3]
          )
            continue;
          for (const axis of [0, 1]) {
            const e = n.incoming.find((e) => e.axis === axis);
            if (!e) continue;
            const p = sample(e, Math.max(0, e.length - 8)),
              lit = green(e, traffic.time);
            c.globalAlpha = 0.65;
            c.fillStyle = lit ? "#8ebc93" : "#e67554";
            const r = Math.max(1.1, 0.65 / camera.zoom);
            c.beginPath();
            c.arc(
              p.x - e.tangent[1] * 5,
              p.y + e.tangent[0] * 5,
              r,
              0,
              Math.PI * 2,
            );
            c.fill();
          }
        }
        c.globalCompositeOperation = "lighter";
        for (const car of traffic.cars) {
          const p = sample(car.edge, car.s),
            o = origin(),
            sx = (p.x - camera.x) * camera.zoom + o[0],
            sy = (p.y - camera.y) * camera.zoom + o[1];
          if (sx < -30 || sx > width + 30 || sy < -30 || sy > height + 30)
            continue;
          const fade = Math.max(
              0,
              Math.min(
                1,
                car.age / 1.5,
                (p.x - city.bounds[0]) / 20,
                (city.bounds[2] - p.x) / 20,
                (p.y - city.bounds[1]) / 20,
                (city.bounds[3] - p.y) / 20,
              ),
            ),
            unit = Math.max(1, 1.6 / camera.zoom),
            len = Math.max(car.length, 3 / camera.zoom);
          c.globalAlpha = fade * 0.7;
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.angle);
          // Short pools follow each vehicle. They never illuminate a whole road uniformly.
          c.drawImage(warmGlow, len * 0.5 - 4, -10, 28, 20);
          c.globalAlpha = fade * 0.85;
          c.drawImage(redGlow, -len * 0.5 - 10, -7, 14, 14);
          c.strokeStyle = "#df714c55";
          c.lineWidth = Math.max(1, 0.9 / camera.zoom);
          c.beginPath();
          c.moveTo(-len * 0.5, 0);
          c.lineTo(-len * 0.5 - 8, 0);
          c.stroke();
          c.globalAlpha = fade;
          c.fillStyle = car.bus
            ? "#8fab9b"
            : car.id % 3 === 0
              ? "#768d95"
              : "#9f9990";
          c.fillRect(-len / 2, -unit / 2, len, unit);
          c.fillStyle = "#ffe4b7";
          c.fillRect(len / 2 - 0.7, -unit / 2, 1.4, unit);
          c.fillStyle = "#ec8058";
          c.fillRect(-len / 2, -unit / 2, 1.1, unit);
          c.restore();
        }
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
      }
      function paintLabels(c) {
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.font = '12px "Microsoft JhengHei",sans-serif';
        for (const {text:label,x,y} of layoutLandmarkLabels(city,camera,{...view,origin:origin(),landmarkAnchors:atlas.landmarkAnchors},text=>c.measureText(text).width)) {
          c.shadowColor = "#02090c";
          c.shadowBlur = 5;
          c.strokeStyle = "#0b1825cc";
          c.lineWidth = 3;
          c.strokeText(label, x, y);
          c.fillStyle = "#d0c4a8";
          c.fillText(label, x, y);
          c.shadowBlur = 0;
        }
      }
      function draw() {
        if (!atlas) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0b161e";
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        const o = origin();
        ctx.translate(...o);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);
        const b = atlas.bounds;
        supportsFilter ??= 'filter' in ctx;
        const brightness = view.brightness ?? 1;
        if (supportsFilter && brightness !== 1) ctx.filter = `brightness(${brightness})`;
        ctx.drawImage(atlas.canvas, b[0], b[1], b[2] - b[0], b[3] - b[1]);
        if (supportsFilter) ctx.filter = 'none';
        else if (brightness !== 1) {
          // Opaque atlases allow equivalent light scaling without Canvas filter support.
          ctx.save();
          if (brightness < 1) {
            ctx.globalAlpha = 1 - brightness; ctx.fillStyle = '#000';
            ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
          } else {
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = brightness - 1;
            ctx.drawImage(atlas.canvas, b[0], b[1], b[2] - b[0], b[3] - b[1]);
          }
          ctx.restore();
        }
        paintRail(ctx);
        paintTraffic(ctx);
        if (atlas.foreground) {
          let foreground = atlas.foreground;
          if (supportsFilter && brightness !== 1) ctx.filter = `brightness(${brightness})`;
          else if (!supportsFilter && brightness !== 1) {
            // Cache the fallback tint without changing the building silhouette's alpha.
            if (foregroundSource !== foreground || foregroundBrightness !== brightness) {
              shadedForeground ??= document.createElement('canvas');
              shadedForeground.width = foreground.width; shadedForeground.height = foreground.height;
              const shade = shadedForeground.getContext('2d', { willReadFrequently: true });
              shade.drawImage(foreground, 0, 0);
              const pixels = shade.getImageData(0, 0, foreground.width, foreground.height);
              for (let i = 0; i < pixels.data.length; i += 4)
                for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] *= brightness;
              shade.putImageData(pixels, 0, 0);
              foregroundSource = foreground; foregroundBrightness = brightness;
            }
            foreground = shadedForeground;
          }
          const f=atlas.foregroundBounds||b;
          ctx.drawImage(foreground, f[0], f[1], f[2] - f[0], f[3] - f[1]);
          if (supportsFilter) ctx.filter = 'none';
        }
        if (shadedForeground && (!atlas.foreground || brightness === 1)) {
          shadedForeground.width = shadedForeground.height = 0;
          shadedForeground = foregroundSource = null;
        }
        ctx.restore();
        if (labels) paintLabels(ctx);
        if (!vignette) return;
        const v = ctx.createRadialGradient(
          width * 0.6,
          height * 0.48,
          height * 0.23,
          width * 0.6,
          height * 0.48,
          Math.max(width, height) * 0.73,
        );
        v.addColorStop(0, "#04121c00");
        v.addColorStop(1, "#04121c8a");
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, width, height);
      }
      function paintRail(c) {
        if (!city?.rail) return;
        c.save();
        c.beginPath();
        c.rect(
          city.bounds[0],
          city.bounds[1],
          city.bounds[2] - city.bounds[0],
          city.bounds[3] - city.bounds[1],
        );
        c.clip();
        drawRail(c, city.rail, city.railRoutes, traffic?.time || 0, {
          aerial: mood === "aerial",
          trains,
          xray,
          zoom: camera.zoom,
        });
        c.restore();
      }

      draw();
    },
    dispose() {
      warmGlow.width = redGlow.width = 0;
      if (shadedForeground) shadedForeground.width = shadedForeground.height = 0;
      foregroundSource = shadedForeground = null;
    },
  };
}

function makeGlow(color) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d"),
    g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color + "cc");
  g.addColorStop(0.13, color + "70");
  g.addColorStop(0.38, color + "24");
  g.addColorStop(1, color + "00");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return cv;
}
