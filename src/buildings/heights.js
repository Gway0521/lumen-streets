// Source measurements remain in metres; projection is an independent art decision.
// Reject ambiguous lists, partial numbers and implausible values instead of clamping them.
export function metres(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (!match) return null;
  const n = Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] || '') ? .3048 : 1);
  return Number.isFinite(n) && n <= 1200 ? n : null;
}

export function floors(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  return n > 0 && n <= 250 ? n : null;
}

export function featureSeed(feature) {
  const key = feature.sourceId || `feature/${feature.id}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function resolveHeight(feature, area, variation = .5) {
  const tags = feature.tags, type = tags.building || tags['building:part'];
  const floorHeight = ['commercial', 'office', 'retail'].includes(type) || tags.office ? 3.6 : 3.2;
  const mapped = metres(tags.height), levels = floors(tags['building:levels']);
  const roof = metres(tags['roof:height']) ?? (floors(tags['roof:levels']) ?? 0) * 3;
  const bottom = metres(tags.min_height) ?? (floors(tags['building:min_level']) ?? 0) * floorHeight;
  const candidates = [];
  if (mapped !== null && mapped > 0) candidates.push({ metres: mapped, source: 'osm:height' });
  if (levels !== null) candidates.push({ metres: levels * floorHeight + roof, source: 'osm:building:levels' });
  const chosen = candidates.find(c => c.metres > bottom && c.metres <= 1200);
  const low = ['garage', 'garages', 'shed', 'roof', 'greenhouse'].includes(type);
  const broad = ['warehouse', 'industrial', 'train_station', 'stadium'].includes(type);
  const tower = tags.man_made === 'tower' || tags.man_made === 'mast';
  const estimate = low ? 4 : broad ? 9 + variation * 9 : tower ? 25 + variation * 15
    : Math.max(4, Math.min(48, Math.sqrt(area) * .8, 10 + Math.sqrt(area) * (.15 + variation * .4)));
  // Bad minimum heights must not make a guessed structure taller than a skyscraper.
  const base = chosen ? bottom : 0;
  return { top: chosen?.metres ?? estimate, bottom: base, source: chosen?.source ?? 'estimate',
    candidates, floorHeight, estimated: !chosen, minimumRejected: !chosen && bottom > 0 };
}
