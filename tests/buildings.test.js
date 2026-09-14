import test from 'node:test';
import assert from 'node:assert/strict';
import { metres, resolveHeight, featureSeed } from '../src/buildings/heights.js';
import { buildingAssemblies } from '../src/buildings/assemblies.js';
import { parseCity } from '../src/city.js';
import { mapQuery } from '../server/maps.mjs';

const square = (x, y, size) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const feature = (id, tags = {}, points = square(0,0,30)) => ({ id, sourceId:`way/${id}`, tags:{building:'yes',...tags},points,holes:[] });

test('height units, floors and roof elevations have distinct semantics', () => {
  assert.equal(metres(' 100 ft '), 30.48);
  assert.equal(metres('508 m'), 508);
  for (const s of ['100;200','12 storeys','12m junk','-3','NaN','Infinity','3e2','9999999']) assert.equal(metres(s), null);
  const measured = resolveHeight(feature(1,{height:'200','min_height':'40','roof:height':'10'}),900);
  assert.equal(measured.top,200); assert.equal(measured.bottom,40);
  const levels = resolveHeight(feature(1,{'building:levels':'20','building:min_level':'3','roof:height':'6'}),900);
  assert.equal(levels.top,70); assert.equal(levels.bottom,9.600000000000001);
  assert.equal(resolveHeight(feature(1,{height:'10',min_height:'20','building:levels':'15'}),900).source,'osm:building:levels');
  assert.equal(resolveHeight(feature(1,{height:'0',min_height:'900'}),900).bottom,0);
  assert.notEqual(featureSeed(feature(1)),featureSeed({...feature(1),sourceId:'node/1'}));
});

test('explicit building relations replace outlines with their parts, preserving source identities', () => {
  const input=[feature(1),feature(2,{'building:part':'yes'},square(0,0,10)),feature(3,{'building:part':'yes'},square(10,0,20))];
  const before=structuredClone(input);
  const relations=[{id:99,tags:{type:'building',wikidata:'Q123'},members:[{type:'way',ref:1,role:'outline'},{type:'way',ref:2,role:'part'},{type:'way',ref:3,role:'part'}]}];
  const b=buildingAssemblies(input,relations);
  assert.deepEqual(b.map(f=>f.role),['outline','part','part']);
  assert(b.every(f=>f.assemblyId==='relation/99'));
  assert.equal(b[2].relationTags.wikidata,'Q123');
  assert.deepEqual(input,before);
});

test('spatial ownership is conservative and ignores ambiguous parents and courtyards', () => {
  const parent=feature(1),part=feature(2,{'building:part':'yes'},square(5,5,5));
  assert.equal(buildingAssemblies([parent,part])[0].role,'outline');
  assert.equal(buildingAssemblies([parent,{...parent,id:3,sourceId:'way/3'},part])[0].role,'body');
  assert.equal(buildingAssemblies([{...parent,holes:[square(4,4,12)]},part])[0].role,'body');
});

test('part-only polygons and tower nodes are structures rather than terrain', () => {
  const region={center:[0,0]},raw={pocketPlaces:{bbox:[-.01,-.01,.01,.01]},elements:[
    {type:'way',id:1,tags:{'building:part':'yes',height:'20'},geometry:square(0,0,.001).map(([lon,lat])=>({lon,lat}))},
    {type:'node',id:2,tags:{man_made:'tower','tower:construction':'lattice'},lon:.001,lat:.001}
  ]};
  const city=parseCity(raw,'test',region);
  assert.equal(city.buildings.length,2);assert.equal(city.land.length,0);
  assert.equal(city.buildings[1].sourceId,'node/2');
  const query=mapQuery({center:[139.76,35.68],size:2});
  assert(query.includes('way["building:part"]'));assert(query.includes('relation[type=building]'));
});
