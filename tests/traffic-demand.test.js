import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph, Traffic, chooseNext} from '../src/traffic.js';

const way=(id,nodes,points,highway)=>({id,nodes,points,tags:{highway,oneway:'yes'}});
test('equal-length roads receive more traffic as road class increases, without overlapping births',()=>{
  const types=['primary','secondary','tertiary','residential','service'];
  const graph=buildGraph({bounds:[-100,-100,20000,1000],roads:types.map((type,i)=>way(i,[i*2,i*2+1],[[0,i*100],[18000,i*100]],type))});
  const sim=new Traffic(graph);sim.setCount(1200);
  const counts=types.map(type=>sim.cars.filter(c=>c.edge.type===type).length);
  assert.equal(sim.cars.length,1200);
  for(let i=1;i<counts.length;i++)assert(counts[i-1]>counts[i],counts.join(','));
  assert(counts.at(-1)>0,'Side streets still carry some traffic');
  for(const edge of graph.edges){const cars=sim.cars.filter(c=>c.edge===edge).sort((a,b)=>a.s-b.s);for(let i=1;i<cars.length;i++)assert(cars[i].s-cars[i-1].s>=10-1e-8);}
  const restored=new Traffic(graph);restored.restore(sim.snapshot());
  for(let i=0;i<100;i++){sim.update(.05);restored.update(.05);}
  assert.deepEqual(restored.snapshot(),sim.snapshot());
});
test('junction choices prefer through roads but ease away from a crowded segment',()=>{
  const graph=buildGraph({bounds:[-300,-300,300,300],roads:[
    way(1,[1,2],[[-200,0],[0,0]],'primary'),
    way(2,[2,3],[[0,0],[200,80]],'primary'),
    way(3,[2,4],[[0,0],[200,-80]],'residential'),
  ]});
  const incoming=graph.edges[0],main=graph.edges[1];
  const count=occupancy=>Array.from({length:1000},(_,i)=>chooseNext(incoming,()=>i/1000,occupancy)).filter(e=>e===main).length;
  const empty=count(),busy=count(new Map([[main.id,Array(18).fill({})]]));
  assert(empty>650&&empty<950);assert(busy<empty/2);assert(busy>0);
});
test('a car leaving a side street can accelerate on the avenue again',()=>{
  const graph=buildGraph({bounds:[-300,-300,300,300],roads:[way(1,[1,2],[[-100,0],[0,0]],'residential'),way(2,[2,3],[[0,0],[200,0]],'primary')]});
  const sim=new Traffic(graph);sim.cars=[{id:0,edge:graph.edges[0],next:graph.edges[1],s:99.9,speed:7,maxSpeed:7,length:4.4,bus:false,age:0,stopped:0}];
  sim.update(.05);assert.equal(sim.cars[0].edge.type,'primary');
  for(let i=0;i<40;i++)sim.update(.05);
  assert(sim.cars[0].speed>9);
});

test('a full short road bounds births and keeps failed respawns inside the graph',()=>{
  const graph=buildGraph({bounds:[-100,-100,100,100],roads:[way(1,[1,2],[[0,0],[25,0]],'residential')]});
  const sim=new Traffic(graph);sim.setCount(100);
  assert(sim.cars.length>0&&sim.cars.length<100);
  for(let i=0;i<1200;i++){
    sim.update(.05);
    for(const car of sim.cars)assert(Number.isFinite(car.s)&&car.s>=0&&car.s<=car.edge.length);
  }
  const restored=new Traffic(graph);restored.restore(sim.snapshot());assert.deepEqual(restored.snapshot(),sim.snapshot());
});
