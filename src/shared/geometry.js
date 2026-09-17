export function project(lon, lat, center) {
  return [
    (lon - center[0]) * 111320 * Math.cos((center[1] * Math.PI) / 180),
    -(lat - center[1]) * 111320,
  ];
}

export function area(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

export function inside(p, poly) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

export function assembleRings(members) {
  const segments = members
    .filter((m) => m.geometry?.length > 1)
    .map((m) =>
      m.geometry
        .filter((p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))
        .map((p) => [p.lon, p.lat]),
    );
  const rings = [],
    same = (a, b) =>
      a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-8;
  while (segments.length) {
    let ring = segments.shift();
    if (ring.length < 2) continue;
    let progress = true;
    while (!same(ring[0], ring.at(-1)) && progress) {
      progress = false;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (same(ring.at(-1), s[0])) {
          ring.push(...s.slice(1));
        } else if (same(ring.at(-1), s.at(-1))) {
          ring.push(...s.toReversed().slice(1));
        } else if (same(ring[0], s.at(-1))) {
          ring = [...s.slice(0, -1), ...ring];
        } else if (same(ring[0], s[0])) {
          ring = [...s.toReversed().slice(0, -1), ...ring];
        } else continue;
        segments.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}
