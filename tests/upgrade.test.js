import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, validateAppearance } from '../src/scene/appearance.ts';
import { createRecipe, validateRecipe } from '../src/scene/recipe.ts';
import { outputPlan, videoSeconds } from '../src/export/framing.ts';
import { paintPlaceTitle, validatePlaceTitle, validateQuietSpace } from '../src/export/png.ts';
import { sceneReference, encodeReference, decodeReference } from '../src/scene/portable.ts';
import { videoStorage, videoStorageAvailable } from '../src/export/storage.ts';

const data = { schemaVersion: 1, id: 'sapporo', fingerprint: 'a'.repeat(64), source: { rail: null } };
test('legacy recipes migrate to original appearance; links retain new settings and reject malformed values', () => {
  const legacy = createRecipe(data); legacy.rendererVersion = 'aerial-1'; delete legacy.appearance;
  assert.deepEqual(validateRecipe(legacy,data).appearance, DEFAULT_APPEARANCE);
  assert.equal(legacy.rendererVersion,'aerial-1'); assert.equal(legacy.appearance,undefined);
  const recipe = createRecipe(data); recipe.appearance = { version:1, brightness:.8, glow:1.4, district:.6, labels:false };
  const round = decodeReference(encodeReference(sceneReference(data,recipe,{width:800,height:600})));
  assert.deepEqual(round.recipe.appearance,recipe.appearance);
  for(const bad of [null,{}, { ...DEFAULT_APPEARANCE,brightness:Infinity }, { ...DEFAULT_APPEARANCE,glow:-1 }, { ...DEFAULT_APPEARANCE,district:3 }, { ...DEFAULT_APPEARANCE,labels:1 }, { ...DEFAULT_APPEARANCE,version:2 }]) assert.throws(()=>validateAppearance(bad));
});
test('1440p respects desktop and portrait framing; custom duration bounds reject coercion',()=>{
  const view={width:1440,height:1000};
  for(const format of ['mp4','webm']) {
    const a=outputPlan(view,'desktop',format,1440), b=outputPlan(view,'portrait',format,1440);
    assert.deepEqual([a.width,a.height],[2560,1440]);assert.deepEqual([b.width,b.height],[1440,2560]);
    assert(a.view.width<=view.width&&a.view.height<=view.height);
  }
  for(const n of [15,60,91,300]) assert.equal(videoSeconds(n),n);
  for(const n of [14,301,NaN,Infinity,15.5,'60']) assert.throws(()=>videoSeconds(n));
  assert.throws(()=>outputPlan(view,'desktop','mp4',2160));
});
test('place titles wrap within safe bounds in all corners, above optional credits',()=>{
  const drawn=[],gradient=()=>({addColorStop(){}}),ctx={save(){},restore(){},translate(){},scale(){},fillRect(){},createRadialGradient:gradient,createLinearGradient:gradient,measureText:s=>({width:[...s].length*20}),fillText:(text,x,y)=>drawn.push({text,x,y})};
  for(const corner of ['top-left','top-right','bottom-left','bottom-right']){
    drawn.length=0;paintPlaceTitle(ctx,1080,1920,{text:'臺北的夜景'.repeat(20),corner,size:'medium'},1830);
    assert(drawn.length<=3);assert(drawn.every(v=>v.x>=40&&v.x<=1040&&v.y>=40&&v.y<1830));
  }
  assert.throws(()=>validatePlaceTitle({text:'x'.repeat(121),corner:'top-left',size:'small'}));
  assert.throws(()=>validatePlaceTitle({text:'test',corner:'anywhere',size:'small'}));
  assert.throws(()=>validatePlaceTitle({text:'a\nb',corner:'top-left',size:'small'}));
  assert.equal(validatePlaceTitle({text:'<script>literal</script>',corner:'top-left',size:'small'}).text,'<script>literal</script>');
});
test('quiet-space options reject non-finite strength and unknown edges without mutating input',()=>{
  const input={edge:'left',strength:.75},copy=validateQuietSpace(input);copy.strength=0;assert.equal(input.strength,.75);
  for(const bad of [null,{}, {edge:'center',strength:.5},{edge:'left',strength:NaN},{edge:'top',strength:1.01},{edge:'right',strength:-1},{edge:'bottom',strength:'1'}]) assert.throws(()=>validateQuietSpace(bad));
});
test('previous renderer scenes migrate without losing appearance, camera or simulation',()=>{
  for(const version of ['aerial-2','aerial-3','aerial-4']){
    const input=createRecipe(data);input.rendererVersion=version;input.appearance.brightness=.75;input.camera.x=120;
    const migrated=validateRecipe(input,data);assert.equal(migrated.rendererVersion,'aerial-5');
    assert.deepEqual({...migrated,rendererVersion:version},input);assert.equal(input.rendererVersion,version);
  }
});
test('large video jobs do not silently fall back to full-memory output without storage',async()=>{
  await assert.rejects(videoStorage(true),/VIDEO_STORAGE_UNAVAILABLE/);
  const short=await videoStorage(false);assert.equal(short.limit,250_000_000);await short.release();
});


test('temporary storage cleans only its own file on failure and repeated release', async () => {
  const old = Object.getOwnPropertyDescriptor(navigator, 'storage');
  const removed = [], created = [];
  let fail = false, aborts = 0;
  const directory = {
    getFileHandle: async name => { created.push(name); return {
      createWritable: async () => { if (fail) throw new DOMException('full', 'QuotaExceededError'); return new WritableStream({ abort() { aborts++; } }); },
      getFile: async () => new Blob(['encoded'])
    }; },
    removeEntry: async name => removed.push(name)
  };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } });
  try {
    const owned = await videoStorage(true); assert.equal((await owned.file('video/mp4')).type, 'video/mp4');
    await owned.release(); await owned.release(); assert.equal(aborts, 1);
    assert.deepEqual(removed, [created[0]]);
    fail = true; await assert.rejects(videoStorage(true), /VIDEO_STORAGE_UNAVAILABLE/);
    assert.deepEqual(removed, created); assert.notEqual(created[0], created[1]);
  } finally { if (old) Object.defineProperty(navigator, 'storage', old); else delete navigator.storage; }
});


test('storage preflight declines known insufficient quota before allocating a file', async () => {
  const old = Object.getOwnPropertyDescriptor(navigator, 'storage'); let allocations = 0;
  Object.defineProperty(navigator, 'storage', { configurable:true, value:{ getDirectory() { allocations++; }, estimate: async () => ({ quota:1_000_000_000, usage:200_000_000 }) } });
  try {
    assert.equal(await videoStorageAvailable(true,1_066_666_667),false);
    assert.equal(await videoStorageAvailable(true,120_000_000),true);
    assert.equal(allocations,0);
  } finally { if(old) Object.defineProperty(navigator,'storage',old); else delete navigator.storage; }
});


test('16:10 exports use native desktop sizes and preserve covered geography', async () => {
  const { wallpaperPlan } = await import('../src/export/framing.ts');
  const view={width:1440,height:900},camera={x:300,y:-200,zoom:.7},before=structuredClone(camera);
  for(const [format,resolution,w,h] of [['png',1080,3840,2400],['gif',1080,720,450],['mp4',1080,1920,1200],['webm',1440,2560,1600]]) {
    const plan=wallpaperPlan(view,[-1000,-1000,1000,1000],camera,'desktop1610',format,resolution);
    assert.deepEqual([plan.width,plan.height],[w,h]);
    assert.equal(plan.width/plan.height,1.6);
    assert(plan.camera.x+plan.view.width/plan.camera.zoom/2<=1000);
    assert(plan.camera.y-plan.view.height/plan.camera.zoom/2>=-1000);
  }
  assert.deepEqual(camera,before);
});
