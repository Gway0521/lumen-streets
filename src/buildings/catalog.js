import pack from './landmarks-v1.json' with { type: 'json' };
import modernPack from './landmarks-v2.json' with { type: 'json' };
import { project } from '../city.js';
import { buildingCenter, buildingArea } from '../lighting.js';

const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export const LEGACY_LANDMARK_PACK = freeze(pack);
export const LANDMARK_PACK = freeze(modernPack);

/** Exact identities plus a geographic check. Names and proximity alone never match. */
export function matchLandmarks(city, profiles = LANDMARK_PACK.profiles) {
  const matches = new Map(), suppressed = new Set();
  if (!city.center) return { matches, suppressed };
  for (const profile of profiles) {
    const anchor = project(...profile.anchor, city.center);
    const candidates = city.buildings.filter(f => {
      const identity = profile.osm.includes(f.sourceId?.replace(/\/outer\/\d+$/, '')) ||
        f.tags.wikidata === profile.wikidata || f.relationTags?.wikidata === profile.wikidata;
      return identity && Math.hypot(...buildingCenter(f.points).map((v, i) => v - anchor[i])) <= profile.radius;
    }).sort((a, b) => (a.role === 'outline' ? -1 : 0) - (b.role === 'outline' ? -1 : 0) ||
      Number(a.sourceId.startsWith('node/')) - Number(b.sourceId.startsWith('node/')) ||
      buildingArea(b.points) - buildingArea(a.points) || a.sourceId.localeCompare(b.sourceId));
    const selected = candidates[0];
    if (!selected) continue;
    matches.set(selected, { profile, anchor });
    const assemblies = new Set(candidates.map(f => f.assemblyId).filter(Boolean));
    const duplicates = new Set(candidates);
    for (const f of city.buildings) if (f !== selected && (duplicates.has(f) || assemblies.has(f.assemblyId))) suppressed.add(f);
  }
  return { matches, suppressed };
}

export function buildingRecipe(city, legacy = false) {
  const selected=legacy?LEGACY_LANDMARK_PACK:LANDMARK_PACK;
  const { matches } = matchLandmarks(city,selected.profiles);
  return { version: legacy?1:2, pack: selected.version, generator: legacy?1:2, projection: legacy?1:2,...(legacy?{}:{elevation:70}),
    profiles: [...matches.values()].map(m => structuredClone(m.profile)).sort((a,b) => a.id.localeCompare(b.id)) };
}
