import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activityField,roadEmission,districtField,streetVariation} from '../src/lighting.js';
import {parseCity,regions} from '../src/city.js';
import {parseRail,buildRailRoutes,railPosition,trainState,underground} from '../src/rail.js';


test('lighting increases with mapped activity while an unmapped area remains dark',()=>{
  const building=(x,y)=>({points:[[x,y],[x+12,y],[x+12,y+12],[x,y+12]],tags:{building:'yes'}});
  const sparse=activityField([building(0,0)]),dense=activityField(Array.from({length:60},(_,i)=>building((i%10)*15,Math.floor(i/10)*15)));
  assert(dense(50,50)>sparse(50,50));assert.equal(dense(2000,2000),0);
  assert(roadEmission({highway:'primary'})>roadEmission({highway:'residential'}));
  assert.equal(roadEmission({highway:'primary',tunnel:'yes'}),0);
  assert.equal(roadEmission({highway:'primary',lit:'no'}),0);
});
test('commercial clusters and stations create districts without lifting a distant residential area',()=>{
  const buildings=Array.from({length:30},(_,i)=>({points:[[i%6*20,Math.floor(i/6)*20],[i%6*20+15,Math.floor(i/6)*20],[i%6*20+15,Math.floor(i/6)*20+15],[i%6*20,Math.floor(i/6)*20+15]],tags:{building:'apartments'}}));
  const residential=districtField({buildings,roads:[]});
  const commercial=districtField({buildings:buildings.map(b=>({...b,tags:{building:'retail'}})),roads:[]});
  assert(commercial(50,50)>residential(50,50)*2);
  const station={point:[50,50],tags:{railway:'station'}};
  const one=districtField({buildings,roads:[],rail:{stations:[station]}});
  const many=districtField({buildings,roads:[],rail:{stations:[station,station,station]}});
  assert(one(50,50)>residential(50,50));assert.equal(one(50,50),many(50,50));
  assert.equal(one(2000,2000),residential(2000,2000));
  assert(Math.abs(one(200,100)-one(200.01,100))<.001);
  assert.notEqual(streetVariation(10,20),streetVariation(230,250));
});
test('major shared-node crossroads brighten locally while bends and tunnels do not',()=>{
  const road=(nodes,points,tunnel)=>({nodes,points,tags:{highway:'primary',tunnel}});
  const horizontal=road([1,2,3],[[-100,0],[0,0],[100,0]]);
  const vertical=road([4,2,5],[[0,-100],[0,0],[0,100]]);
  const field=roads=>districtField({buildings:[],roads})(0,0);
  assert(field([horizontal,vertical])>field([horizontal]));
  assert.equal(field([horizontal,{...vertical,tags:{...vertical.tags,tunnel:'yes'}}]),field([horizontal]));
});
test('a train follows a bend, stops at its mapped station, and finishes with a departure gap',()=>{
  const route={parts:[{a:[0,0],b:[200,0],start:0,length:200,hidden:false},{a:[200,0],b:[200,200],start:200,length:200,hidden:true}],length:400,stops:[160],mode:'subway'};
  assert.equal(trainState(route,11).s,160);assert.equal(trainState(route,17).dwelling,true);
  const moving=trainState(route,22);assert(moving.s>160);
  assert.deepEqual(railPosition(route,250),{x:200,y:50,angle:Math.PI/2,hidden:true});
  assert.equal(railPosition(route,-1),null);assert.equal(trainState(route,40),null);
  assert(underground({railway:'subway',location:'underground'}));
  assert(!underground({railway:'light_rail',bridge:'yes',layer:'1'}));
});
test('all bundled rail routes retain finite train geometry across ten simulated minutes',()=>{
  for(const id of Object.keys(regions)){
    const raw=JSON.parse(readFileSync(new URL('../public/data/'+id+'.json',import.meta.url),'utf8'));
    const city=parseCity(raw,id);
    const rail=parseRail(JSON.parse(readFileSync(new URL('../public/data/'+id+'-rail.json',import.meta.url),'utf8')),city.center);
    const routes=buildRailRoutes(rail,city.bounds);
    assert(rail.tracks.length>0,id);assert(routes.length>0,id);
    for(const [i,route] of routes.entries())for(let t=0;t<=600;t+=.5){
      const state=trainState(route,t,i);if(!state)continue;
      const p=railPosition(route,state.s);assert(p&&Number.isFinite(p.x+p.y+p.angle),id);
      assert(state.s>=0&&state.s<=route.length,id);
    }
  }
});
