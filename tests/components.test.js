import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCity,inside} from '../src/city.js';
import {LANDMARK_PACK,buildingRecipe} from '../src/buildings/catalog.js';
import {resolveRenderPlan} from '../src/buildings/plan.js';
import {prepareBuildings} from '../src/building-depth.js';
import {orderedPrimitives} from '../src/buildings/order.js';
import {validateStructures} from '../src/scene/structures.ts';
import {sceneProjection,transformPoint} from '../src/engine/projection.js';
import {generateComponents,trianglePrimitive} from '../src/buildings/components.js';
import {sceneReference,encodeReference,decodeReference} from '../src/scene/portable.ts';
import {createSceneData} from '../src/scene/data.ts';
import {createRecipe} from '../src/scene/recipe.ts';

const raw=readFileSync(new URL('../public/data/shanghai.json',import.meta.url),'utf8');
const city=parseCity(JSON.parse(raw),'shanghai');
const square=(id,x,y,w,tags={})=>({id,sourceId:`way/${id}`,assemblyId:'way/1',role:id===1?'outline':'part',points:[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]],holes:[],tags:{building:'yes',...tags}});

test('whole-building classification retains identity and platform semantics without copying total height',()=>{
  const parent=square(1,-15,-15,30,{name:'Test tower',height:'200','tower:construction':'lattice'});
  const leg=square(2,-10,-10,3,{'building:part':'yes',height:'80'});
  const platform=square(3,-8,-8,16,{'building:part':'platform',height:'90',min_height:'84'});
  const annex=square(4,10,10,4,{'building:part':'annex',height:'5'});
  const observation=square(5,-4,-4,8,{'building:part':'observatory','building:material':'glass',height:'130',min_height:'120'});
  const data={buildings:[parent,leg,platform,annex,observation]};
  const b=prepareBuildings(data,()=>.5,[],{generator:2,projection:2,elevation:70});
  assert.equal(Math.max(...b.rods.flatMap(r=>[r.a[2],r.b[2]])),200);
  assert.equal(b.rods.length,65);assert.equal(b.length,3);
  assert(b.some(p=>p.elevation.bottom===84&&p.elevation.top===90));
  assert(b.some(p=>p.elevation.top===5));
  assert(b.some(p=>p.elevation.bottom===120&&p.elevation.top===130));
});

test('reviewed replacement keeps annexes, explicit exclusions and outlying parts',()=>{
  const p=structuredClone(LANDMARK_PACK.profiles[1]);p.replace={sources:['way/1'],partsWithin:20,keep:['way/3']};
  const parent=square(1,-30,-30,60,{wikidata:p.wikidata});
  const members=[parent,square(2,-4,-4,8,{'building:part':'yes'}),square(3,5,5,3,{'building:part':'yes'}),
    square(4,6,6,4,{'building:part':'annex'}),square(5,24,24,3,{'building:part':'yes'})];
  const data={center:p.anchor,buildings:members};
  const plan=resolveRenderPlan(data,[p]);
  assert.equal(plan.models.length,1);assert.deepEqual(plan.bindings[0].replaced,['way/1','way/2']);
  assert.deepEqual(plan.bindings[0].retained,['way/3','way/4','way/5']);
  assert.deepEqual(resolveRenderPlan(data,[p]),plan);
  p.replace={sources:['way/199758828'],partsWithin:20,keep:['way/1']};
  assert.equal(resolveRenderPlan(data,[p]).models.length,0,'An explicitly kept identity match must not receive a duplicate model');
});

test('Shanghai profiles preserve sourced heights and produce finite, bounded, ordered solids',()=>{
  const settings=buildingRecipe(city),plan=resolveRenderPlan(city,settings.profiles);
  assert.equal(plan.models.length,4);
  let totalOverlaps=0;
  for(const m of plan.models) {
    const t=generateComponents(m.feature,m.anchor,m.profile);
    assert(t.length<6000);assert(t.every(t=>t.vertices.flat().every(Number.isFinite)));
    assert(Math.abs(Math.max(...t.flatMap(t=>t.vertices.map(v=>v[2])))-m.profile.height)<1e-7);
    const b=prepareBuildings({...city,buildings:[m.feature]},()=>.5,[m.profile],settings);
    const {units}=orderedPrimitives(b);
    let count=0;
    const pts=units.flatMap(u=>u.points),minX=Math.min(...pts.map(p=>p[0])),maxX=Math.max(...pts.map(p=>p[0])),minY=Math.min(...pts.map(p=>p[1])),maxY=Math.max(...pts.map(p=>p[1]));
    for(let x=minX;x<maxX;x+=7.13)for(let y=minY;y<maxY;y+=6.71){
      const cover=units.filter(u=>inside([x,y],u.points));if(cover.length<2)continue;
      assert(cover.at(-1).height([x,y])>=Math.max(...cover.map(u=>u.height([x,y])))-.06,`${m.profile.id}: occlusion`);count++;
    }
    totalOverlaps+=count;
  }
  assert(totalOverlaps>5);
  const stats=orderedPrimitives(prepareBuildings(city,()=>.5,settings.profiles,settings)).stats;
  assert.equal(stats.ambiguous,0);assert.equal(stats.cycles,0);
});

test('sphere silhouette follows the same orthographic camera as the ground',()=>{
  const profile={art:{rotation:0},components:[{kind:'ellipsoid',material:'rose',windows:false,center:[0,0,100],radii:[20,20,20]}]};
  const {direction,matrix}=sceneProjection({projection:2,elevation:70});
  const triangles=generateComponents({sourceId:'way/9'},[0,0],profile);
  const points=triangles.map(t=>trianglePrimitive(t,direction)).filter(Boolean).flatMap(u=>u.points).map(p=>transformPoint(p,matrix));
  const w=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),h=Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
  assert(Math.abs(w-h)<1);assert(w>39&&h>39);
});

test('component imports reject excessive geometry, invalid coordinates and ambiguous replacement',()=>{
  const settings=buildingRecipe(city);
  for(const edit of [p=>p.components=Array(41).fill(p.components[0]),p=>p.components[0].sections[0][0]=NaN,
    p=>p.components[0].sections[0][1]=10000,p=>p.components[0].url='https://example.org',p=>p.replace.keep=p.replace.sources,
    p=>p.replace.sources=['../model'],p=>p.components[0].sections.reverse()]) {
    const s=structuredClone(settings),p=s.profiles.find(p=>p.id==='shanghai-tower');edit(p);assert.throws(()=>validateStructures(s));
  }
});

test('Shanghai links bind reviewed profiles by content hash while files can retain authored changes',async()=>{
  const data=await createSceneData('shanghai',raw,null),recipe=createRecipe(data);
  const ref=sceneReference(data,recipe,{width:1280,height:800});assert(ref);
  const encoded=encodeReference(ref);assert(encoded.length<2000);
  assert.deepEqual(decodeReference(encoded),ref);
  const changed=JSON.parse(Buffer.from(encoded.replaceAll('-','+').replaceAll('_','/'),'base64'));
  changed.landmarkProfiles.sha256='0'.repeat(64);
  assert.throws(()=>decodeReference(Buffer.from(JSON.stringify(changed)).toString('base64url')));
  recipe.structures.profiles[0].art.rotation+=1;
  assert.equal(sceneReference(data,recipe,{width:1280,height:800}),null);
});
