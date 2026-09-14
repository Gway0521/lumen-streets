import { buildingRecipe, LANDMARK_PACK } from '../buildings/catalog.js';
import type { SceneData } from './data.ts';

export interface LandmarkProfile {
  id: string; revision: number; wikidata: string; osm: string[];
  anchor: [number, number]; radius: number; height: number;
  generator: 'tiered' | 'lattice'; art: Record<string, number>; heightSource: string;
}
export interface StructureRecipe {
  version: 1 | 2; pack: string; generator: 1 | 2; projection: 1 | 2; elevation?: number; profiles: LandmarkProfile[];
}
const fail = (): never => { throw new Error('Invalid or incompatible building settings'); };
const object = (v: any, keys: string[]) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length ||
    !Object.keys(v).every(k => keys.includes(k))) fail();
};
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const token = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,80}$/.test(v);

/** Embedded data only: no paths, network lookups, textures or executable model code. */
export function validateStructures(input: unknown): StructureRecipe {
  const r = input as StructureRecipe;
  object(r,r.version===2?['version','pack','generator','projection','elevation','profiles']:['version','pack','generator','projection','profiles']);
  if (![1,2].includes(r.version) || r.generator !== r.version || r.projection !== r.version ||
    (r.version===2 && !number(r.elevation,55,85)) || !token(r.pack) ||
    !Array.isArray(r.profiles) || r.profiles.length > 16) fail();
  const ids = new Set(), entities = new Set();
  for (const p of r.profiles) {
    object(p,['id','revision','wikidata','osm','anchor','radius','height','generator','art','heightSource']);
    if (!token(p.id) || ids.has(p.id) || !Number.isInteger(p.revision) || !number(p.revision,1,10000) ||
      typeof p.wikidata !== 'string' || !/^Q[1-9]\d{0,11}$/.test(p.wikidata) || entities.has(p.wikidata) ||
      !Array.isArray(p.osm) || p.osm.length > 8 || p.osm.some(s => typeof s !== 'string' || !/^(way|node|relation)\/[1-9]\d{0,15}$/.test(s)) ||
      !Array.isArray(p.anchor) || p.anchor.length !== 2 || !number(p.anchor[0],-180,180) || !number(p.anchor[1],-80,80) ||
      !number(p.radius,5,250) || !number(p.height,20,1200) || !token(p.heightSource)) fail();
    ids.add(p.id);entities.add(p.wikidata);
    const a=p.art;
    if (p.generator === 'tiered') {
      object(a,['rotation','width','podium','base','tiers','tierTop','crown','spireBase','taper']);
      if (!Number.isInteger(a.tiers) || !number(a.tiers,1,16) || !number(a.taper,.5,1) ||
        !(a.podium < a.base && (a.tierTop-a.base)/a.tiers > 4 && a.tierTop < a.crown && a.crown < a.spireBase && a.spireBase < p.height-10)) fail();
    } else if (p.generator === 'lattice') {
      object(a,['rotation','width','podium','platform','observation','observationWidth','mastBase','clock']);
      if (!number(a.observationWidth,0,100) || !(a.podium < a.platform-3 && a.platform < a.observation*.5 &&
        a.observation+6 < a.mastBase && a.mastBase < p.height && a.clock > a.platform+5 && a.clock < a.observation-8)) fail();
    } else fail();
    if (!number(a.rotation,-180,180) || !number(a.width,3,150) || !number(a.podium,0,60) ||
      !Object.entries(a).every(([k,v]) => k === 'rotation' || number(v,0,1200))) fail();
  }
  return structuredClone(r);
}

export function createStructures(data: SceneData, legacy = false): StructureRecipe {
  // Link decoding can precede source loading. Geographic/identity matching still happens at render time.
  const recipe = data.geometry ? buildingRecipe(data.geometry) :
    {version:1,pack:LANDMARK_PACK.version,generator:1,projection:1,profiles:LANDMARK_PACK.profiles};
  return validateStructures(legacy ? recipe : {...recipe,version:2,generator:2,projection:2,elevation:70});
}
