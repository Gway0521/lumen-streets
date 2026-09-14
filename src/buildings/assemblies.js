import { area, inside } from '../city.js';

export const isPart = f => !!f.tags['building:part'] && f.tags['building:part'] !== 'no';
export const isStructure = f => (f.tags.building && f.tags.building !== 'no') || isPart(f) ||
  ['tower', 'mast'].includes(f.tags.man_made);
const bounds = f => f.points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const contains = (f, p) => inside(p, f.points) && !(f.holes || []).some(h => inside(p, h));

/** Resolve ownership once, without mutating source features or merging unrelated names. */
export function buildingAssemblies(features, relations = []) {
  const all = features.filter(f => isStructure(f) && f.points.length > 3), mapped = new Map();
  for(const f of all)if(!f.sourceId.startsWith('node/') && f.tags.wikidata) {
    if(!mapped.has(f.tags.wikidata))mapped.set(f.tags.wikidata,[]);mapped.get(f.tags.wikidata).push(f);
  }
  const buildings=all.filter(f=>!f.sourceId.startsWith('node/') || !(mapped.get(f.tags.wikidata)||[]).some(p=>contains(p,f.points[0])));
  const byId = new Map();
  for (const f of buildings) {
    const id = f.sourceId.replace(/\/outer\/\d+$/, '');
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(f);
  }
  const owner = new Map(), outlines = new Set(), assignments = new Map();
  const relationById = new Map(relations.map(r => [`relation/${r.id}`, r]));
  for (const relation of relations) {
    if (relation.tags?.type !== 'building') continue;
    const members = relation.members || [];
    const parts = members.filter(m => m.role === 'part').flatMap(m => byId.get(`${m.type}/${m.ref}`) || []);
    const parents = members.filter(m => m.role === 'outline').flatMap(m => byId.get(`${m.type}/${m.ref}`) || []);
    if (!parts.length || !parents.length) continue;
    const id = `relation/${relation.id}`;
    for (const f of [...parents, ...parts]) {
      if (assignments.has(f) && assignments.get(f) !== id) assignments.set(f, null);
      else if (!assignments.has(f)) assignments.set(f, id);
    }
    for (const f of parts) owner.set(f, id);
    for (const f of parents) outlines.add(f);
  }
  // A spatial grid limits containment work on dense city snapshots.
  const grid = new Map(), boxes = new Map();
  for (const f of buildings.filter(f => !isPart(f) && !owner.has(f))) {
    const b = bounds(f); boxes.set(f, b);
    if ((Math.ceil((b[2]-b[0])/100)+1)*(Math.ceil((b[3]-b[1])/100)+1)>4096) continue;
    for (let x = Math.floor(b[0] / 100); x <= Math.floor(b[2] / 100); x++)
      for (let y = Math.floor(b[1] / 100); y <= Math.floor(b[3] / 100); y++) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        if(grid.get(key).length<256)grid.get(key).push(f);
      }
  }
  for (const part of buildings.filter(f => isPart(f) && !assignments.has(f))) {
    const b = bounds(part), center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const candidates = (grid.get(`${Math.floor(center[0] / 100)},${Math.floor(center[1] / 100)}`) || []).filter(f => {
      const p = boxes.get(f);
      return f !== part && p[0] <= b[0] && p[1] <= b[1] && p[2] >= b[2] && p[3] >= b[3] &&
        area(f.points) > area(part.points) * 1.01 && contains(f, center) &&
        part.points.every(v => contains(f, [v[0] * .999 + center[0] * .001, v[1] * .999 + center[1] * .001]));
    });
    if (candidates.length !== 1) continue;
    const parent = candidates[0];
    const id = assignments.get(parent) || parent.sourceId;
    owner.set(part, id); assignments.set(part, id); assignments.set(parent, id); outlines.add(parent);
  }
  return buildings.map(f => ({ ...f, assemblyId: assignments.get(f) || f.sourceId,
    role: assignments.get(f) === null ? (isPart(f) ? 'part' : 'body') : outlines.has(f) ? 'outline' : owner.has(f) || isPart(f) ? 'part' : 'body',
    relationTags: relationById.get(assignments.get(f))?.tags || {} }));
}
