import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { LANDMARK_PACK, matchLandmarks } from '../src/buildings/catalog.js';
import { validateStructures } from '../src/scene/structures.ts';
import { parseCity, regions, inside } from '../src/city.js';
import { metres } from '../src/buildings/heights.js';
import { generateStructure } from '../src/buildings/generators.js';

const path='data/landmarks/manifest-v1.json',sourcePath='data/landmarks/sources-v1.json';
const sources=JSON.parse(await readFile(sourcePath,'utf8'));
validateStructures({version:1,pack:LANDMARK_PACK.version,generator:1,projection:1,profiles:LANDMARK_PACK.profiles});
assert.equal(sources.pack,LANDMARK_PACK.version);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const matches=[];
for(const id of Object.keys(regions)) {
  const file=`public/data/${id}.json`,bytes=await readFile(file),raw=JSON.parse(bytes),city=parseCity(raw,id);
  for(const [feature,{profile,anchor}]of matchLandmarks(city).matches) {
    assert(inside(anchor,feature.points),`${profile.id}: anchor outside mapped outline`);
    const source=sources.sources.find(s=>s.id===profile.heightSource),decision=sources.decisions.find(d=>d.profile===profile.id);
    assert(source&&decision,`${profile.id}: missing provenance`);assert.equal(source.value,profile.height);
    const original=raw.elements.find(e=>`${e.type}/${e.id}`===feature.sourceId);
    assert(decision.candidates.some(c=>c.source==='osm:height'&&c.raw===original.tags.height),`${profile.id}: source conflict needs review`);
    const shape=generateStructure(feature,anchor,profile);
    const actual=Math.max(...shape.profiles.map(b=>b.elevation.top),...shape.rods.flatMap(r=>[r.a[2],r.b[2]]));
    assert.equal(actual,profile.height);assert(shape.profiles.length<=40&&shape.rods.length<=100);
    matches.push({city:id,profile:profile.id,sourceId:feature.sourceId,mapSHA256:digest(bytes),height:profile.height,
      mappedMetres:metres(original.tags.height),conflict:metres(original.tags.height)!==profile.height,
      solidParts:shape.profiles.length,rods:shape.rods.length});
  }
}
assert.equal(new Set(matches.map(m=>m.profile)).size,LANDMARK_PACK.profiles.length,'Every profile must have a reviewed map fixture');
const manifest={version:1,pack:LANDMARK_PACK.version,packSHA256:digest(await readFile('src/buildings/landmarks-v1.json')),
  sourcesSHA256:digest(await readFile(sourcePath)),matches};
if(process.argv.includes('--write'))await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
else assert.deepEqual(JSON.parse(await readFile(path,'utf8')),manifest,'Run npm run prepare:landmarks and review the changed manifest');
console.log(JSON.stringify(manifest,null,2));
