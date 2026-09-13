import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneData} from '../src/scene/data.ts';
import {regions} from '../src/city.js';
import {selectLandmarks,layoutLandmarkLabels,landmarkName} from '../src/landmarks.js';
import {streetColorField,tintStreet} from '../src/street-colors.js';
import {roadEmission} from '../src/lighting.js';

const feature=(id,x,y,tags)=>({id,sourceId:`way/${id}`,points:[[x-10,y-10],[x+10,y-10],[x+10,y+10],[x-10,y+10]],tags});
test('landmarks deduplicate translated names and locations, prefer authored names, and exclude off-map places',()=>{
 const city={bounds:[-1000,-1000,1000,1000],labels:['Library'],features:[feature(1,0,0,{name:'Library',amenity:'library'}),feature(2,30,0,{name:'圖書館','name:en':'Library',tourism:'museum'}),feature(3,2000,0,{name:'Outside',tourism:'museum'}),feature(4,400,0,{name:'Museum','name:zh-Hant':'博物館',tourism:'museum'})]};
 const before=structuredClone(city),places=selectLandmarks(city);assert.deepEqual(places.map(p=>p.name),['Library','Museum']);assert.deepEqual(city,before);
 assert.equal(landmarkName(places[1],'zh-TW'),'博物館');assert.equal(landmarkName(places[1],'en'),'Museum');
 const reverse=selectLandmarks({...city,features:[...city.features].reverse()});assert.deepEqual(reverse,places);
});
test('warm fields are continuous; cool tints exist only around separated mapped landmarks',()=>{
 const city={bounds:[-2000,-2000,2000,2000],features:[feature(1,0,0,{name:'Museum',tourism:'museum'}),feature(2,100,0,{name:'Annex',tourism:'museum'}),feature(3,800,0,{name:'Park',tourism:'attraction',landuse:'forest'})]};
 const field=streetColorField(city);assert.equal(field.anchors.length,1);assert(field.sample(0,0).cool>.8);assert.equal(field.sample(800,0).cool,0);
 for(let x=-1500;x<1500;x+=17){const a=field.sample(x,0),b=field.sample(x+.001,0);assert(Math.abs(a.warm-b.warm)<.001&&Math.abs(a.cool-b.cool)<.001);assert.deepEqual(a,field.sample(x,0));}
 const a=tintStreet([255,189,101],field.sample(-1200,0)),b=tintStreet([255,189,101],field.sample(1200,0));assert.notDeepEqual(a,b);assert(a[0]>a[1]&&a[1]>a[2]);
 for(const highway of ['residential','service','footway','path','cycleway','steps']){assert(roadEmission({highway})>0);assert.equal(roadEmission({highway,lit:'no'}),0);assert.equal(roadEmission({highway,tunnel:'yes'}),0);}
});
test('all presets yield attributed labels and bounded accents without label rectangle collisions',async()=>{
 for(const id of Object.keys(regions)){
  const data=await createSceneData(id,readFileSync(`public/data/${id}.json`,'utf8'),readFileSync(`public/data/${id}-rail.json`,'utf8')),city=data.geometry;
  const places=selectLandmarks(city);assert(places.length>=3,id);assert(places.every(p=>p.sourceId&&p.name));
  const field=streetColorField(city);assert(field.anchors.length>0&&field.anchors.length<=3,id);
  const [l,t,r,b]=city.bounds,camera={x:(l+r)/2,y:(t+b)/2,zoom:Math.min(900/(r-l),700/(b-t))};
  for(const locale of ['en','zh-TW']){
   const labels=layoutLandmarkLabels(city,camera,{width:1000,height:800,quietMode:true,locale},s=>[...s].length*7);
   assert(labels.length>=2&&labels.length<=9,`${id}/${locale}`);
   for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    const a=labels[i].rect,b=labels[j].rect;assert(a[2]<=b[0]||a[0]>=b[2]||a[3]<=b[1]||a[1]>=b[3]);
   }
  }
 }
});
