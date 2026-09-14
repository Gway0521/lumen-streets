import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { regions } from "../src/city.js";
import { createSceneData } from "../src/scene/data.ts";
import { createRecipe } from "../src/scene/recipe.ts";
import { SceneEngine } from "../src/engine/scene-engine.ts";
import { sceneFile, readSceneFile, boundedJSON, sceneReference, encodeReference, decodeReference, hostedSceneURL, fetchSceneFile, SCENE_FILE_LIMIT } from "../src/scene/portable.ts";
import { Playback } from "../src/player/playback.ts";
const read = name => readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), "utf8");
const resources = { atlas: data => ({ canvas: { width: 100, height: 100 }, bounds: [...data.geometry.bounds] }), painter: () => ({ render() {}, dispose() {} }) };
const view = { width: 1440, height: 1000 };
const data = await createSceneData("sapporo", read("sapporo"), read("sapporo-rail"));
const original = new SceneEngine(data, createRecipe(data), resources); original.playing = false; original.setDensity(43); original.advance(2.37);
const file = sceneFile(data, original.snapshot(), view), raw = JSON.parse(await file.text());

test("all eight complete files round trip with identical fingerprints, geometry and simulation continuation", async () => {
  for (const id of Object.keys(regions)) {
    const data = await createSceneData(id, read(id), read(id + "-rail"));
    const a = new SceneEngine(data, createRecipe(data), resources); a.setDensity(37); a.advance(1.23); a.setCamera({ x: 10, y: -20, zoom: .8 });
    const before = a.snapshot(), blob = sceneFile(data, before, view), restored = await readSceneFile(blob);
    assert(blob.size < SCENE_FILE_LIMIT); assert.equal(restored.data.fingerprint, data.fingerprint);
    assert.deepEqual(restored.recipe, before); assert.deepEqual(restored.view, view);
    assert.deepEqual(restored.data.geometry, data.geometry); assert.deepEqual(a.snapshot(), before);
    const b = new SceneEngine(restored.data, restored.recipe, resources); a.advance(4); b.advance(4); assert.deepEqual(a.snapshot(), b.snapshot()); a.dispose(); b.dispose();
  }
});
test("file parser rejects corrupt, incompatible, oversized and unsafe data before rendering", async () => {
  for (const patch of [f => f.version = 2, f => f.license = "none", f => f.source.id = "../secret", f => f.source.region.bbox = [0,0,80,180], f => f.recipe.rendererVersion = "future", f => f.recipe.camera.zoom = 100, f => delete f.recipe.checkpoint,
    f => { const m = JSON.parse(f.source.mapText); m.elements[0].id += 10; f.source.mapText = JSON.stringify(m); },
    f => { const m = JSON.parse(f.source.mapText); m.pocketPlaces.source = "javascript:alert(1)"; f.source.mapText = JSON.stringify(m); },
    f => f.recipe.checkpoint.cars[0].speed = -1]) {
    const changed = structuredClone(raw); patch(changed); await assert.rejects(readSceneFile(new Blob([JSON.stringify(changed)])));
  }
  await assert.rejects(readSceneFile(new Blob(["null"])));
  for (const content of ["{", '{"__proto__":{"polluted":true}}', '['.repeat(33)+']'.repeat(33)]) assert.throws(() => boundedJSON(content));
  assert.equal({}.polluted, undefined);
  await assert.rejects(readSceneFile({ size: SCENE_FILE_LIMIT + 1, text() { throw new Error("should not read"); } }), /sceneTooLarge/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(readSceneFile(file, controller.signal), { name: "AbortError" });
});
test("reference links preserve composition and reproducible controls without a live checkpoint or arbitrary source", () => {
  const snapshot = original.snapshot(), ref = sceneReference(data, snapshot, view), encoded = encodeReference(ref);
  assert(encoded.length < 2000); const decoded = decodeReference(encoded);
  assert.equal(decoded.recipe.simulationTime, 8); assert.equal(decoded.recipe.checkpoint, undefined);
  assert.deepEqual(decoded.recipe.camera, snapshot.camera); assert.equal(decoded.recipe.density, 43); assert.equal(decoded.recipe.playing, false);
  assert.deepEqual(original.snapshot(), snapshot);
  for (const patch of [{version:2}, {recipe:{...ref.recipe,dataId:'../xinyi'}}, {recipe:{...ref.recipe,simulationTime:3600}}, {recipe:snapshot}]) assert.throws(()=>decodeReference(encodeReference({...ref,...patch})));
  assert.throws(()=>decodeReference('a'.repeat(6001))); assert.throws(()=>decodeReference('%bad'));
  assert.equal(sceneReference({...data,id:'custom'}, {...snapshot,dataId:'custom'}, view), null);
});
test("embedded landmark settings survive offline files and malformed generator parameters fail before rendering", async () => {
  const modified=structuredClone(raw);
  modified.recipe.structures.pack='archived-pack-1';
  modified.recipe.structures.profiles[0].art.rotation=7;
  const restored=await readSceneFile(new Blob([JSON.stringify(modified)]));
  assert.deepEqual(restored.recipe.structures,modified.recipe.structures);
  const native=globalThis.fetch;
  try {
    globalThis.fetch=()=>{throw Error('Offline scene attempted network access');};
    await readSceneFile(new Blob([JSON.stringify(modified)]));
  } finally {globalThis.fetch=native;}
  for(const patch of [f=>f.recipe.structures.generator=2,f=>delete f.recipe.structures,
    f=>f.recipe.structures.profiles[0].art.width=10000,f=>f.recipe.structures.profiles[0].modelURL='https://example.org/model']) {
    const changed=structuredClone(raw);patch(changed);
    await assert.rejects(readSceneFile(new Blob([JSON.stringify(changed)])));
  }
});
test("hosted files are bounded same-origin static paths, redirects and transport failures do not silently replace data", async () => {
  const base = 'https://example.org/lumen/player.html';
  assert.equal(hostedSceneURL('scenes/tokyo.lumen.json',base).href,'https://example.org/lumen/scenes/tokyo.lumen.json');
  for(const path of ['../private.lumen.json','https://elsewhere.test/a.lumen.json','//elsewhere.test/a.lumen.json','data:text/plain,{}','api/map','a.lumen.json?token=private','%2e%2e/private.lumen.json']) assert.throws(()=>hostedSceneURL(path,base));
  const native = globalThis.fetch; let cancelled = false;
  try {
    globalThis.fetch = async () => ({ok:true,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(10_000_001));},cancel(){cancelled=true}})});
    await assert.rejects(fetchSceneFile('huge.lumen.json',base,new AbortController().signal), /sceneTooLarge/); assert(cancelled);
  } finally { globalThis.fetch = native; }
});
test("player stops offscreen/background, resets elapsed time and retains manual pause intent", () => {
  const p = new Playback(); p.desired = true; assert.equal(p.running,false); p.intersecting=true;
  assert.equal(p.tick(1000),0); assert.equal(p.tick(1050),.085);
  p.visible=false; assert.equal(p.tick(5000),0); p.visible=true; assert.equal(p.tick(9000),0);
  p.intersecting=false; assert.equal(p.tick(10000),0); p.intersecting=true; assert.equal(p.tick(11000),0);
  p.desired=false; p.visible=false; p.visible=true; assert.equal(p.running,false);
});
