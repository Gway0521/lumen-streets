import { random } from './city.js';
import { buildingArea, buildingCenter, commerce } from './lighting.js';

// A fixed oblique projection in world metres. Heights are scenic, not surveyed.
export const ROOF_DIRECTION = Object.freeze([-.32, -.48]);
const signedArea = ring => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

export function buildingProfile(feature, activity = .5) {
  const area = Math.max(1, buildingArea(feature.points) - (feature.holes || []).reduce((sum, ring) => sum + buildingArea(ring), 0));
  const r = random(feature.id + 701), center = buildingCenter(feature.points);
  const low = ['garage', 'garages', 'shed', 'roof', 'greenhouse'].includes(feature.tags.building);
  const broad = ['warehouse', 'industrial', 'train_station', 'stadium'].includes(feature.tags.building);
  const levels = Number.parseFloat(feature.tags['building:levels']);
  const mappedHeight = Number.parseFloat(feature.tags.height);
  const hint = Number.isFinite(mappedHeight) && mappedHeight > 0 ? mappedHeight
    : Number.isFinite(levels) && levels > 0 ? levels * 3.2 : null;
  const scenic = low ? 4 : broad ? 9 + r() * 9
    : 9 + Math.sqrt(area) * (.18 + r() * .65) * (.7 + activity * .5 + (commerce(feature.tags) ? .3 : 0));
  const height = Math.max(3, Math.min(hint ?? scenic, low ? 7 : broad ? 25 : hint === null && area > 12000 ? 48 : 125, Math.sqrt(area) * 1.25));
  const offset = ROOF_DIRECTION.map(v => v * height);
  const project = p => [p[0] + offset[0], p[1] + offset[1]];
  const roof = feature.points.map(project), holes = (feature.holes || []).map(ring => ring.map(project));
  const faces = [];
  for (const [index, ring] of [feature.points, ...(feature.holes || [])].entries()) {
    const orientation = Math.sign(signedArea(ring)) * (index ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const facing = orientation * (dy * offset[0] - dx * offset[1]) / length;
      if (facing >= -.01) continue;
      faces.push({ a, b, length, points: [a, b, project(b), project(a)], exposure: -facing / Math.hypot(...offset) });
    }
  }
  return { feature, area, center, height, offset, roof, holes, faces,
    depth: center[0] * -ROOF_DIRECTION[0] + center[1] * -ROOF_DIRECTION[1] };
}

function outline(c, points, holes = []) {
  c.beginPath();
  for (const ring of [points, ...holes]) {
    ring.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p));
    c.closePath();
  }
}

export function prepareBuildings(city, activity) {
  return city.buildings.filter(f => buildingArea(f.points) >= 8)
    .map(f => buildingProfile(f, activity(...buildingCenter(f.points))))
    .sort((a, b) => a.depth - b.depth || a.feature.id - b.feature.id);
}

export function paintBuildingShadows(c, buildings) {
  c.save();
  for (const b of buildings) {
    c.save();
    c.translate(b.height * .13, b.height * .19);
    outline(c, b.feature.points, b.feature.holes);
    c.fillStyle = '#01050980'; c.fill('evenodd');
    c.restore();
  }
  c.restore();
}

// Opaque structures occupy a separate atlas, composited after moving lights.
// Windows are painted on the visible facade plane, with dark floors between them.
export function paintBuildings(c, buildings, activity, glow = 1) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'butt';
  for (const b of buildings) {
    const f = b.feature, a = activity(...b.center), r = random(f.id + 931);
    const commercial = commerce(f.tags), active = Math.min(.72, .12 + a * .32 + (commercial ? .12 : 0));
    const tone = r(), windowColor = tone < .16 ? '176,208,220' : tone < .44 ? '230,224,196' : '255,207,139';
    for (const face of b.faces) {
      outline(c, face.points);
      const facade = c.createLinearGradient(...face.a, face.a[0] + b.offset[0], face.a[1] + b.offset[1]);
      facade.addColorStop(0, face.exposure > .65 ? '#10191c' : '#091116');
      facade.addColorStop(1, face.exposure > .65 ? '#16232a' : '#0d1820');
      c.fillStyle = facade; c.fill();
      c.save(); c.clip();
      const dx = (face.b[0] - face.a[0]) / face.length, dy = (face.b[1] - face.a[1]) / face.length;
      const floors = Math.min(30, Math.max(1, Math.floor(b.height / 4.2)));
      const spacing = commercial ? 4.1 : 4.8;
      for (let floor = 0; floor < floors; floor++) {
        const t = (floor + .55) / floors;
        const occupancy = r() < .13 ? .03 : active;
        for (let d = 2.2; d < face.length - 1.7; d += spacing) {
          if (r() > occupancy) continue;
          const x = face.a[0] + dx * d + b.offset[0] * t, y = face.a[1] + dy * d + b.offset[1] * t;
          const strength = (.3 + r() * .6) * (.55 + a * .5);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx * 2.1, y + dy * 2.1);
          c.lineWidth = 3.4; c.strokeStyle = `rgba(${windowColor},${strength * .12 * glow})`; c.stroke();
          c.lineWidth = 1.05; c.strokeStyle = `rgba(${windowColor},${strength})`; c.stroke();
        }
      }
      // A few warm shopfronts anchor buildings to the street.
      if (commercial) {
        c.beginPath(); c.moveTo(face.a[0] + dx * 2, face.a[1] + dy * 2);
        c.lineTo(face.b[0] - dx * 2, face.b[1] - dy * 2);
        c.strokeStyle = `rgba(239,184,104,${.15 + a * .19})`; c.lineWidth = 1.5; c.stroke();
      }
      c.restore();
    }
    outline(c, b.roof, b.holes);
    c.fillStyle = ['#14212a', '#111c24', '#19262e', '#0e1c25'][Math.floor(r() * 4)]; c.fill('evenodd');
    c.strokeStyle = '#75848b38'; c.lineWidth = .65; c.stroke();
    c.save(); c.clip('evenodd');
    const xs = b.roof.map(p => p[0]), ys = b.roof.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const shade = c.createLinearGradient(minX, minY, maxX + 1, maxY + 1);
    shade.addColorStop(0, '#8195a01a'); shade.addColorStop(1, '#02090e70');
    c.fillStyle = shade; c.fillRect(minX, minY, maxX - minX, maxY - minY);
    if (b.area > 350) {
      // Recessed roof deck and parapet; clipping preserves concave courtyards.
      const cx = b.center[0] + b.offset[0], cy = b.center[1] + b.offset[1];
      const inset = b.roof.map(p => [cx + (p[0] - cx) * .83, cy + (p[1] - cy) * .83]);
      outline(c, inset); c.fillStyle = '#030a1066'; c.fill();
      c.strokeStyle = '#8e9f9b28'; c.lineWidth = .75; c.stroke();
    }
    // Quiet residential roofs recede together with their district's windows.
    c.fillStyle = `rgba(2,8,13,${.22 * (1 - Math.min(1, a))})`;
    c.fillRect(minX, minY, maxX - minX, maxY - minY);
    // Roof equipment follows the dominant footprint edge, rather than north.
    let edge = [b.roof[0], b.roof[1]], longest = 0;
    for (let i = 1; i < b.roof.length; i++) {
      const length = Math.hypot(b.roof[i][0] - b.roof[i - 1][0], b.roof[i][1] - b.roof[i - 1][1]);
      if (length > longest) { longest = length; edge = [b.roof[i - 1], b.roof[i]]; }
    }
    const angle = Math.atan2(edge[1][1] - edge[0][1], edge[1][0] - edge[0][0]);
    for (let i = 0; i < Math.min(24, Math.floor(b.area / 150)); i++) {
      const x = minX + 4 + r() * Math.max(1, maxX - minX - 8), y = minY + 4 + r() * Math.max(1, maxY - minY - 8);
      c.save(); c.translate(x, y); c.rotate(angle);
      const width = 2 + r() * 5, height = 2 + r() * 4;
      c.fillStyle = '#03090cb0'; c.fillRect(1, 2, width + 1, height + 1);
      c.fillStyle = '#47565e80'; c.fillRect(0, 0, width, height);
      c.fillStyle = '#99a6a32c'; c.fillRect(0, 0, width, .7);
      c.restore();
    }
    c.restore();
  }
  c.restore();
}
