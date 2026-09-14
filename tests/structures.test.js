import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCity, inside } from '../src/city.js';
import { buildingProfile, prepareBuildings } from '../src/building-depth.js';
import { LANDMARK_PACK, matchLandmarks, buildingRecipe } from '../src/buildings/catalog.js';
import { orderedPrimitives, visualBounds } from '../src/buildings/order.js';
import { validateStructures } from '../src/scene/structures.ts';
import { createRecipe, validateRecipe } from '../src/scene/recipe.ts';

const city = id => parseCity(JSON.parse(readFileSync(new URL(`../public/data/${id}.json`,import.meta.url))),id);
const square=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]];
const feature=(id,x,y,w,height)=>({id,sourceId:`way/${id}`,points:square(x,y,w),holes:[],tags:{building:'yes',height:String(height)}});

test('landmark matching uses exact identity, geographic bounds and one assembly replacement',()=>{
  const data=city('xinyi'),before=structuredClone(data);
  const {matches}=matchLandmarks(data);assert.equal(matches.size,1);
  const [f,{profile}]=[...matches][0];assert.equal(f.sourceId,'way/1159328965');assert.equal(profile.id,'taipei-101');
  assert(data.buildings.some(f=>f.tags.name?.includes('Exit 5')));
  const named={...f,sourceId:'way/other',tags:{building:'yes',name:'Taipei 101 / MRT Exit 5'}};
  assert.equal(matchLandmarks({...data,buildings:[named]}).matches.size,0);
  assert.equal(matchLandmarks({...data,center:[0,0]}).matches.size,0);
  const node={...f,sourceId:'node/42',assemblyId:'node/42',points:square(f.points[0][0],f.points[0][1],6)};
  const duplicate=matchLandmarks({...data,buildings:[node,f]});assert.equal(duplicate.matches.size,1);assert(duplicate.suppressed.has(node));
  assert.deepEqual(data,before);
});

test('models keep measured top heights, a low shopping podium and genuinely open tower geometry',()=>{
  for(const [id,height]of [['xinyi',508],['sapporo',144]]) {
    const data=city(id),recipe=buildingRecipe(data),{matches}=matchLandmarks(data),source=[...matches.keys()][0];
    const small={...data,buildings:[source]},b=prepareBuildings(small,()=>.5,recipe.profiles);
    assert.equal(Math.max(...b.map(p=>p.elevation.top),...b.rods.flatMap(r=>[r.a[2],r.b[2]])),height);
    if(id==='xinyi'){assert(b.some(p=>p.feature===source&&p.elevation.top<40));assert(b.length>10);}
    else {assert.equal(b.length,5);assert.equal(b.rods.length,65);assert(!b.some(p=>p.elevation.bottom<40&&p.elevation.top>70));}
    assert.deepEqual(prepareBuildings(small,()=>.5,recipe.profiles),b);
    assert(orderedPrimitives(b).units.every(u=>u.points.flat().every(Number.isFinite)));
  }
});

test('unknown lattice towers get an open neutral frame without borrowed landmark decks',()=>{
  const f=feature(9,0,0,12,100);f.tags['tower:construction']='lattice';
  const b=prepareBuildings({buildings:[f]},()=>.5,[]);
  assert.equal(b.length,0);assert(b.rods.length>0);
  assert(b.rods.some(r=>r.material==='iron'));assert(!b.rods.some(r=>r.material==='steel'));
  f.tags.min_height='20';const raised=prepareBuildings({buildings:[f]},()=>.5,[]);
  const elevations=raised.rods.flatMap(r=>[r.a[2],r.b[2]]);assert.equal(Math.min(...elevations),20);assert.equal(Math.max(...elevations),100);
});

test('projected primitive order agrees with independent ray elevations across overlapping roofs and walls',()=>{
  const b=[feature(1,35,35,35,160),feature(2,0,0,34,24),feature(3,28,0,16,90)].map(f=>buildingProfile(f));
  const {units,stats}=orderedPrimitives(b);assert.equal(stats.cycles,0);
  let samples=0;
  for(let x=-15;x<70;x+=2.71)for(let y=-35;y<70;y+=3.13) {
    const p=[x,y],cover=units.filter(u=>inside(p,u.points));if(cover.length<2)continue;
    assert(cover.at(-1).height(p)>=Math.max(...cover.map(u=>u.height(p)))-.06);samples++;
  }
  assert(samples>30);
  const bounds=visualBounds(b,[0,0,80,80]);assert(bounds[0]<0&&bounds[1]<0);
  assert.deepEqual(orderedPrimitives(b).units.map(u=>u.points),orderedPrimitives(b.toReversed()).units.map(u=>u.points));
});

test('embedded profiles are bounded, detached from the pack and pin generator/projection versions',()=>{
  const config=buildingRecipe(city('sapporo')),validated=validateStructures(config);
  validated.profiles[0].height=143;assert.equal(config.profiles[0].height,144);assert.equal(LANDMARK_PACK.profiles[1].height,144);
  const patches=[r=>r.generator=99,r=>r.projection=99,r=>r.profiles=Array(17).fill(r.profiles[0]),r=>r.profiles[0].art.observation=NaN,
    r=>r.profiles[0].height=Infinity,r=>r.profiles[0].generator='mesh',r=>r.profiles[0].url='https://example.org',r=>r.profiles[0].art.width=100000,
    r=>r.profiles[0].anchor=[0,90],r=>r.profiles[0].osm=['../x'],r=>r.profiles[0].art.clock=140];
  for(const patch of patches){const copy=structuredClone(config);patch(copy);assert.throws(()=>validateStructures(copy));}
  const data={schemaVersion:1,id:'test',fingerprint:'a'.repeat(64)},recipe=createRecipe(data);
  assert.throws(()=>validateRecipe({...recipe,structures:undefined},data));
  assert.equal(validateRecipe({...recipe,rendererVersion:'aerial-6',structures:undefined},data).structures.generator,1);
  // An embedded older pack remains usable without fetching or substituting the latest pack.
  const offline={...config,pack:'archived-pack-1'};assert.deepEqual(validateStructures(offline),offline);
});
