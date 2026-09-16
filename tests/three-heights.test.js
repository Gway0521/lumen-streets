import test from "node:test";
import assert from "node:assert/strict";
import { tileHeight } from "../src/three/building-heights.js";
import { boundedBytes, decodeHeightTile, validateManifest } from "../src/three/height-tiles.js";
import { BuildingTiles } from "../src/three/tiles.js";
import { vectorGeometry } from "../src/three/geometry.js";

const feature = () => ({type:"Feature",id:"overture/one",properties:{
  lumen_height_version:1,source_id:"overture/one",height_raw:null,floors_raw:null,
  height_missing:true,height_m:42,min_height_m:2,height_source:"plateau",height_source_id:"1",
  height_method:"survey",height_definition:"ground_to_top",height_estimated:false,height_match:.91,
},geometry:{type:"Polygon",coordinates:[[[0,.001],[.0002,.001],[.0002,.0012],[0,.0012],[0,.001]]]}});
const encoded = features => new TextEncoder().encode(JSON.stringify({type:"FeatureCollection",features})).buffer;
const manifest = () => ({version:1,zoom:14,revision:"test",regions:[{tile_bounds:[8192,8191,8193,8191],tiles:"tiles/{z}/{x}/{y}.json"}],attribution:["Project PLATEAU"]});

test("lossy 5 m is unknown; prepared missing values preserve provenance", () => {
  const old = tileHeight({render_height:5});
  assert.equal(old.top,5);
  assert.equal(old.method,"upstream-unknown");
  assert.equal(old.estimated,null);
  assert.equal(old.missing,null);
  const h = tileHeight(feature().properties);
  assert.equal(h.raw,null);
  assert.equal(h.missing,true);
  assert.equal(h.source,"plateau");
  assert.equal(h.estimated,false);
  assert.throws(()=>tileHeight({...feature().properties,height_m:NaN}));
  assert.throws(()=>tileHeight({...feature().properties,height_method:"model"}));
});

test("prepared height reaches detailed and overflow geometry without forging OSM tags", () => {
  const f = feature(), copy = structuredClone(f);
  const detailed = vectorGeometry([f],[0,0],5000,15);
  const overflow = vectorGeometry([f],[0,0],0,13);
  assert.equal(detailed.buildings,1);
  assert.equal(overflow.boxes.length,12);
  assert.equal(overflow.boxes[2],2);
  assert.equal(overflow.boxes[5],40);
  assert.deepEqual(f,copy);
});

test("prepared tiles reject malformed geometry and unsupported manifests", () => {
  assert.equal(decodeHeightTile(encoded([feature()])).length,1);
  const f=feature(); f.geometry.coordinates[0][2][0]=Infinity;
  assert.throws(()=>decodeHeightTile(encoded([f])));
  assert.throws(()=>validateManifest({...manifest(),version:2}));
  assert.throws(()=>validateManifest({...manifest(),regions:[{tile_bounds:[0,0,1,1],tiles:"bad"}]}));
});

test("streaming size budget cancels the response before an oversized body is retained", async () => {
  let cancelled=false;
  const response=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}}));
  await assert.rejects(boundedBytes(response,30),/size budget/);
  assert.equal(cancelled,true);
});

test("viewport loading deduplicates uncut footprints and shares a bounded cache", async t => {
  const calls=[];
  t.mock.method(globalThis,"fetch",async input=>{
    const url=String(input);calls.push(url);
    if(url.endsWith("base.json"))return Response.json({tiles:["base/{z}/{x}/{y}.pbf"]});
    if(url.endsWith("manifest.json"))return Response.json(manifest());
    if(url.endsWith(".pbf"))return new Response(new Uint8Array());
    return new Response(encoded([feature()]));
  });
  const loader=new BuildingTiles(), seen=[];
  const result=await loader.load([0,.001,.03,.002],"https://example.org/base.json",true,new AbortController().signal,
    (fs,env,context)=>{assert.equal(context.prepared,true);seen.push(...fs);},"https://example.org/heights/manifest.json");
  assert.equal(seen.length,1);
  assert.equal(result.preparedTiles.size,2);
  assert.deepEqual(result.attribution,["Project PLATEAU"]);
  assert.ok(calls.some(u=>u.includes("/heights/tiles/14/8192/8191.json")));
  const requests=calls.length;
  await loader.load([0,.001,.03,.002],"https://example.org/base.json",true,new AbortController().signal,()=>{},"https://example.org/heights/manifest.json");
  assert.equal(calls.length,requests);
  assert.ok(loader.bytes<=8*1048576);
});

test("coverage absence uses the basemap; an advertised missing tile reports failure", async t => {
  t.mock.method(globalThis,"fetch",async input=>{
    const url=String(input);
    if(url.endsWith("base.json"))return Response.json({tiles:["base/{z}/{x}/{y}.pbf"]});
    if(url.endsWith("manifest.json"))return Response.json(manifest());
    if(url.endsWith(".pbf"))return new Response(new Uint8Array());
    return new Response("",{status:404});
  });
  const loader=new BuildingTiles();
  const r=await loader.load([1,.001,1.001,.002],"https://example.org/base.json",false,new AbortController().signal,()=>{},"https://example.org/manifest.json");
  assert.equal(r.preparedTiles.size,0);
  await assert.rejects(loader.load([0,.001,.001,.002],"https://example.org/base.json",false,new AbortController().signal,()=>{},"https://example.org/manifest.json"),/404/);
  const c=new AbortController();c.abort();
  await assert.rejects(loader.load([0,.001,.001,.002],"https://example.org/base.json",false,c.signal,()=>{},"https://example.org/manifest.json"),{name:"AbortError"});
});
