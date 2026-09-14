import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseCity,regions,inside} from '../src/city.js';
import {LANDMARK_PACK} from '../src/buildings/catalog.js';
import {validateStructures} from '../src/scene/structures.ts';
import {prepareBuildings} from '../src/building-depth.js';
import {orderedPrimitives} from '../src/buildings/order.js';
import {resolveRenderPlan} from '../src/buildings/plan.js';
const digest=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['data/landmarks/sources-v1.json','data/landmarks/sources-v2.json'];
const sourceBytes=await Promise.all(sourcePaths.map(p=>readFile(p)));
const sourceSets=sourceBytes.map(b=>JSON.parse(b)),sources=sourceSets.flatMap(s=>s.sources);
const settings=validateStructures({version:2,pack:LANDMARK_PACK.version,generator:2,projection:2,elevation:70,profiles:LANDMARK_PACK.profiles});
const matches=[];
for(const id of Object.keys(regions)) {
  const bytes=await readFile(`public/data/${id}.json`),raw=JSON.parse(bytes),city=parseCity(raw,id);
  const plan=resolveRenderPlan(city,settings.profiles);
  for(const m of plan.models) {
    const p=m.profile,source=sources.find(s=>s.id===p.heightSource);
    assert(source&&source.value===p.height,`${p.id}: missing verified height`);
    assert(inside(m.anchor,m.feature.points),`${p.id}: anchor outside mapped outline`);
    const b=prepareBuildings({...city,buildings:city.buildings.filter(f=>f.assemblyId===m.feature.assemblyId)},()=>.5,[p],settings);
    const vertices=[...b.flatMap(x=>[x.elevation.bottom,x.elevation.top]),...b.rods.flatMap(r=>[r.a[2],r.b[2]]),...(b.triangles||[]).flatMap(t=>t.vertices.map(v=>v[2]))];
    assert(Math.abs(Math.max(...vertices)-p.height)<1e-6,`${p.id}: incorrect top elevation`);
    const order=orderedPrimitives(b);assert(order.units.every(u=>u.points.flat().every(Number.isFinite)));
    const binding=plan.bindings.find(x=>x.profile===p.id);assert(binding.replaced.includes(m.feature.sourceId));
    const decision=sourceSets.flatMap(s=>s.decisions).find(d=>d.profile===p.id);
    const original=raw.elements.find(e=>`${e.type}/${e.id}`===m.feature.sourceId);
    if('mappedHeight' in decision)assert.equal(original.tags.height??null,decision.mappedHeight,`${p.id}: source changed, review required`);
    matches.push({city:id,profile:p.id,mapSHA256:digest(bytes),height:p.height,binding,primitives:order.stats.primitives,triangles:b.triangles?.length||0});
  }
}
assert.equal(matches.length,settings.profiles.length,'Every profile needs a bundled fixture');
const manifest={version:2,pack:settings.pack,packSHA256:digest(await readFile('src/buildings/landmarks-v2.json')),sources:sourcePaths.map((path,i)=>({path,sha256:digest(sourceBytes[i])})),matches};
const path='data/landmarks/manifest-v2.json';
if(process.argv.includes('--write'))await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
else assert.deepEqual(JSON.parse(await readFile(path,'utf8')),manifest,'Review then run npm run prepare:landmarks');
console.log(`Validated ${matches.length} landmark assemblies and bounded geometry.`);
