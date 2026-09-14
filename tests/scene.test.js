import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSceneData, SceneDataError } from "../src/scene/data.ts";
import { createRecipe, validateRecipe } from "../src/scene/recipe.ts";
import { createStructures } from '../src/scene/structures.ts';
import { SceneEngine } from "../src/engine/scene-engine.ts";
import { exportPNG, encodePNG } from "../src/export/png.ts";
import { random } from "../src/city.js";
import { Traffic, buildGraph } from "../src/traffic.js";

const read = (name) =>
  readFileSync(
    new URL("../public/data/" + name + ".json", import.meta.url),
    "utf8",
  );
const map = read("xinyi"),
  rail = read("xinyi-rail");
const data = await createSceneData("xinyi", map, rail);
const resources = () => ({
  atlas: (data) => ({
    canvas: { width: 100, height: 100 },
    bounds: [...data.geometry.bounds],
  }),
  painter: () => ({ render() {}, dispose() {} }),
});
const make = (recipe) =>
  new SceneEngine(data, recipe ?? createRecipe(data), resources());

test("versioned data preserves geometry, source identities, attribution and immutable provenance", async () => {
  const copy = await createSceneData("xinyi", map, rail);
  assert.equal(data.fingerprint, copy.fingerprint);
  assert.match(data.source.attribution, /OpenStreetMap.*ODbL/);
  assert.equal(data.projection.axes, "east-south");
  assert.deepEqual(data.projection.origin, [121.5645, 25.0355]);
  assert(data.geometry.buildings.some((f) => f.holes.length));
  assert.equal(
    new Set(data.geometry.features.map((f) => f.sourceId)).size,
    data.geometry.features.length,
  );
  assert(
    data.geometry.rail.stations.every((f) => f.sourceId.startsWith("node/")),
  );
  assert.throws(() => {
    data.geometry.roads[0].points[0][0] = 5;
  }, TypeError);
  assert.equal(
    data.geometry.bounds[0] < 0 && data.geometry.bounds[3] > 0,
    true,
  );
  const withoutRail = await createSceneData("xinyi", map, null);
  assert.notEqual(withoutRail.fingerprint, data.fingerprint);
  assert.equal(withoutRail.geometry.railUnavailable, true);
  assert.equal(withoutRail.source.rail, null);
  const changed = JSON.parse(rail);
  changed.elements[0].id += 1;
  assert.notEqual(
    (await createSceneData("xinyi", map, JSON.stringify(changed))).fingerprint,
    data.fingerprint,
  );
});

test("invalid snapshots and incompatible recipes fail at the boundary", async () => {
  for (const text of [
    "null",
    "{",
    "{}",
    JSON.stringify({
      ...JSON.parse(map),
      pocketPlaces: { bbox: [0, 0, 0, 0] },
    }),
  ]) {
    await assert.rejects(createSceneData("xinyi", text, null), SceneDataError);
  }
  await assert.rejects(createSceneData("../xinyi", map, rail), SceneDataError);
  const recipe = createRecipe(data);
  for (const patch of [
    { schemaVersion: 2 },
    { rendererVersion: "future" },
    { dataFingerprint: "changed" },
    { camera: { x: Infinity, y: 0, zoom: 1 } },
    { palette: "unknown" },
    { density: -1 },
    { seed: 0.1 },
    { simulationTime: 4000 },
    { remainder: 1 },
    { checkpoint: { time: 8, cars: [] } },
    { checkpoint: null },
  ])
    assert.throws(() => validateRecipe({ ...recipe, ...patch }, data));
});

test("checkpoint random sequence matches the accepted renderer generator", () => {
  const sim = new Traffic(buildGraph(data.geometry), 29),
    rng = random(29);
  for (let i = 0; i < 1000; i++) assert.equal(sim.rng(), rng());
});

test("fixed-step rendering state is reproducible across frame schedules and JSON restoration", () => {
  const a = make(),
    b = make();
  a.advance(2);
  for (let i = 0; i < 200; i++) b.advance(0.01);
  assert.deepEqual(a.snapshot().checkpoint, b.snapshot().checkpoint);
  a.setDensity(15);
  a.advance(0.137);
  a.setDensity(92);
  a.setRail(false, true);
  a.setCamera({ x: 120, y: -70, zoom: 0.7 });
  a.playing = false;
  const checkpoint = JSON.parse(JSON.stringify(a.snapshot()));
  const c = make(checkpoint);
  assert.deepEqual(c.snapshot(), a.snapshot());
  a.advance(55);
  c.advance(55);
  assert.deepEqual(
    c.snapshot(),
    a.snapshot(),
    "continued RNG and edge transitions remain identical",
  );
  for (const engine of [a, b, c]) engine.dispose();
});

test("instances, returned recipes and disposal cannot mutate another scene", () => {
  const a = make(),
    before = a.snapshot(),
    b = make(before);
  before.camera.x = 80;
  before.checkpoint.cars[0].s = 0;
  const frozen = a.snapshot();
  b.setCamera({ x: -50, y: 100, zoom: 2 });
  b.setDensity(0);
  b.setPalette("blue");
  b.advance(5);
  b.playing = false;
  const camera = a.camera;
  camera.zoom = 4;
  assert.deepEqual(a.snapshot(), frozen);
  b.dispose();
  b.dispose();
  assert.throws(() => b.advance(1), /disposed/);
  assert.deepEqual(a.snapshot(), frozen);
  const bad = a.snapshot();
  bad.checkpoint.cars[0].edge = 999999;
  assert.throws(() => make(bad), /edge/);
  a.dispose();
});

test("PNG success, encoder failure, cancelled replay and cancelled encoding leave live state untouched", async () => {
  // Fake only the browser canvas/encoder here. Browser QA verifies real PNG pixels and downloads.
  const allocated = [];
  let encoding = "success";
  const context = {
    drawImage() {},
    setTransform() {},
    fillRect() {},
    fillText() {},
    save() {},
    restore() {},
    measureText(s) {
      return { width: s.length * 6 };
    },
  };
  const previous = globalThis.document;
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob(callback) {
          if (encoding === "throw") throw new Error("encoder unavailable");
          if (encoding !== "pending")
            callback(
              encoding === "null"
                ? null
                : new Blob(["png"], { type: "image/png" }),
            );
        },
      };
      allocated.push(canvas);
      return canvas;
    },
  };
  const live = make(),
    before = live.snapshot();
  const options = {
    mode: "view",
    width: 640,
    height: 480,
    title: "Lumen Streets",
    view: { width: 640, height: 480 },
  };
  try {
    assert.equal((await exportPNG(live, options)).type, "image/png");
    for (const failure of ["null", "throw"]) {
      encoding = failure;
      await assert.rejects(exportPNG(live, options));
      assert.deepEqual(live.snapshot(), before);
    }
    encoding = "success";
    const controller = new AbortController();
    const job = exportPNG(live, {
      ...options,
      mode: "study",
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(job, { name: "AbortError" });
    assert.deepEqual(live.snapshot(), before);
    encoding = "pending";
    const pending = new AbortController();
    const job2 = exportPNG(live, { ...options, signal: pending.signal });
    pending.abort();
    await assert.rejects(job2, { name: "AbortError" });
    assert.deepEqual(live.snapshot(), before);
    assert(
      allocated.every((c) => c.width === 0),
      "all export-owned canvases released",
    );
    await assert.rejects(exportPNG(live, { ...options, width: 50000 }));
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(encodePNG({}, aborted.signal), { name: "AbortError" });
  } finally {
    live.dispose();
    globalThis.document = previous;
  }
});


test("appearance changes retain simulation and camera; atlas failure is atomic", () => {
  let builds = 0, fail = false;
  const base = resources();
  const engine = new SceneEngine(data, createRecipe(data), { ...base, atlas: (...args) => {
    builds++; if (fail) throw new Error('atlas failed'); return base.atlas(...args);
  } });
  const before = engine.snapshot(), original = before.appearance;
  engine.setAppearance({ ...original, brightness: .8, labels: false });
  assert.equal(builds, 1);
  engine.setAppearance({ ...original, glow: 1.5, district: .4 });
  assert.equal(builds, 2);
  assert.deepEqual(engine.snapshot().checkpoint, before.checkpoint);
  assert.deepEqual(engine.camera, before.camera);
  const changed = engine.snapshot(); fail = true;
  assert.throws(() => engine.setAppearance({ ...original, glow: .1 }), /atlas failed/);
  assert.deepEqual(engine.snapshot(), changed);
  assert.throws(() => engine.setAppearance({ ...original, brightness: NaN }), /appearance/);
  assert.deepEqual(engine.snapshot(), changed);
  fail = false; engine.setPalette('blue'); const blueBuilds = builds;
  engine.setAppearance(original); assert.equal(builds, blueBuilds);
  engine.dispose();
});

test('legacy artwork upgrades only explicitly and retains simulation even when a rebuild fails',()=>{
  const recipe=createRecipe(data);recipe.rendererVersion='aerial-7';recipe.structures=createStructures(data,true);
  let fail=false;const base=resources(),engine=new SceneEngine(data,recipe,{...base,atlas:(...args)=>{
    if(fail)throw Error('construction failed');return base.atlas(...args);
  }});
  const before=engine.snapshot();assert(engine.legacyArtwork);
  fail=true;assert.throws(()=>engine.upgradeArtwork(),/construction failed/);assert.deepEqual(engine.snapshot(),before);
  fail=false;engine.upgradeArtwork();assert(!engine.legacyArtwork);
  assert.equal(engine.snapshot().structures.version,2);
  assert.deepEqual(engine.snapshot().checkpoint,before.checkpoint);assert.deepEqual(engine.camera,before.camera);
  engine.dispose();
});

test('structure atlases are copied for captures and released on replacement, disposal and failed forks', () => {
  const atlases = [], copies = [], previous = globalThis.document;
  let failCopy = false;
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext() {
      return failCopy && copies.length % 2 === 0 ? null : { drawImage() {} };
    } };
    copies.push(canvas); return canvas;
  } };
  const resource = { painter: () => ({ render() {}, dispose() {} }), atlas: () => {
    const atlas = { canvas: { width: 100, height: 80 }, foreground: { width: 100, height: 80 }, bounds: [...data.geometry.bounds] };
    atlases.push(atlas); return atlas;
  } };
  let live;
  try {
    live = new SceneEngine(data, createRecipe(data), resource);
    const before = live.snapshot(), capture = live.fork();
    assert.equal(copies.length, 2);
    capture.dispose(); assert(copies.every(c => c.width === 0 && c.height === 0));
    assert.equal(atlases[0].foreground.width, 100);
    assert.deepEqual(live.snapshot(), before);
    failCopy = true; assert.throws(() => live.fork(), /Canvas/);
    assert(copies.every(c => c.width === 0 && c.height === 0));
    assert.equal(atlases[0].foreground.width, 100);
    live.setPalette('blue');
    assert.equal(atlases[0].foreground.width, 0); assert.equal(atlases[0].canvas.height, 0);
    live.dispose(); assert.equal(atlases[1].foreground.height, 0);
    assert.throws(() => new SceneEngine(data, createRecipe(data), { ...resource, painter() { throw Error('painter failed'); } }), /painter failed/);
    assert.equal(atlases.at(-1).foreground.width, 0);
  } finally { live?.dispose(); globalThis.document = previous; }
});
