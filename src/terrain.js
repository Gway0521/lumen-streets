import { random } from './city.js';

export function terrainKind(tags) {
  if (tags.natural === 'water' || tags.waterway || tags.landuse === 'reservoir') return 'water';
  if (['park', 'garden', 'golf_course'].includes(tags.leisure) ||
      ['wood', 'scrub', 'grassland'].includes(tags.natural) ||
      ['forest', 'grass', 'recreation_ground', 'meadow'].includes(tags.landuse)) return 'green';
  return 'ground';
}

function outline(c, feature) {
  c.beginPath();
  for (const ring of [feature.points, ...feature.holes]) {
    ring.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.closePath();
  }
}

// Quiet detail in the negative space: canopies and ripples, clipped to real land.
export function paintTerrain(c, city) {
  for (const f of city.land) {
    const kind = terrainKind(f.tags); if (kind === 'ground') continue;
    const xs = f.points.map(p => p[0]), ys = f.points.map(p => p[1]);
    const x0 = Math.max(city.bounds[0], Math.min(...xs)), y0 = Math.max(city.bounds[1], Math.min(...ys));
    const x1 = Math.min(city.bounds[2], Math.max(...xs)), y1 = Math.min(city.bounds[3], Math.max(...ys));
    if (x1 <= x0 || y1 <= y0) continue;
    c.save(); outline(c, f); c.clip('evenodd');
    c.fillStyle = kind === 'water' ? '#050e16' : '#0a1513'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    const r = random(f.id + 127), count = Math.min(6500, (x1 - x0) * (y1 - y0) / (kind === 'water' ? 180 : 85));
    for (let i = 0; i < count; i++) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      if (kind === 'water') {
        c.strokeStyle = `rgba(78,112,125,${.025 + r() * .035})`; c.lineWidth = .65;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2 + r() * 7, y - .5); c.stroke();
      } else {
        const radius = 2 + r() * 5;
        c.fillStyle = '#02080955'; c.beginPath(); c.arc(x + 2, y + 3, radius, 0, Math.PI * 2); c.fill();
        c.fillStyle = ['#101d18', '#14211d', '#0c1816', '#18252070'][Math.floor(r() * 4)];
        c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#66725c19'; c.lineWidth = .8; c.beginPath(); c.arc(x, y, radius * .8, 3.5, 5.2); c.stroke();
      }
    }
    c.restore();
  }
}

// Reflect only nearby road lamps; the water remains dark away from the shore.
export function paintReflections(c, city, lamps) {
  const cells = new Map(), step = 100;
  for (const lamp of lamps) {
    const key = `${Math.floor(lamp.x / step)},${Math.floor(lamp.y / step)}`;
    if (!cells.has(key)) cells.set(key, []); cells.get(key).push(lamp);
  }
  for (const f of city.land) {
    if (terrainKind(f.tags) !== 'water') continue;
    const nearby = new Set();
    for (const ring of [f.points, ...f.holes]) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d <= length; d += 45) {
        const t = length ? d / length : 0, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        if (x < city.bounds[0] - 100 || x > city.bounds[2] + 100 || y < city.bounds[1] - 100 || y > city.bounds[3] + 100) continue;
        const gx = Math.floor(x / step), gy = Math.floor(y / step);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
          for (const lamp of cells.get(`${gx + dx},${gy + dy}`) || [])
            if (Math.hypot(lamp.x - x, lamp.y - y) < 46) nearby.add(lamp);
      }
    }
    c.save(); outline(c, f); c.clip('evenodd');
    for (const lamp of nearby) {
      const r = random(Math.round(lamp.x * 71 + lamp.y * 137));
      const g = c.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 48);
      g.addColorStop(0, `rgba(224,161,80,${lamp.alpha * .22})`); g.addColorStop(1, '#dba15a00');
      c.fillStyle = g; c.fillRect(lamp.x - 48, lamp.y - 48, 96, 96);
      for (let i = 0; i < 24; i++) {
        const dx = (r() - .5) * 65, dy = (r() - .5) * 80, fade = Math.max(0, 1 - Math.hypot(dx, dy) / 45);
        c.strokeStyle = `rgba(238,180,106,${fade * lamp.alpha * .3})`; c.lineWidth = .8;
        c.beginPath(); c.moveTo(lamp.x + dx, lamp.y + dy); c.lineTo(lamp.x + dx + 1 + r() * 4, lamp.y + dy - .4); c.stroke();
      }
    }
    c.restore();
  }
}
