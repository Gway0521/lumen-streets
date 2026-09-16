import test from "node:test";
import assert from "node:assert/strict";
import { outputPlan, cropView, wallpaperPlan, screenDimensions } from "../src/export/framing.ts";
import { paintCapture } from "../src/export/png.ts";

test("screen exports use the full display regardless of browser chrome and window size", () => {
  const display = screenDimensions({ width: 432, height: 960, orientation: { type: "portrait-primary" } }, 2.5);
  const camera = { x: 100, y: -150, zoom: .8 }, before = structuredClone(camera);
  for (const viewport of [{width:432,height:810,dpr:1.8}, {width:432,height:740,dpr:1.8}]) {
    const original = structuredClone(viewport);
    for (const [format, resolution, expected] of [["png",1080,[1080,2400]],["gif",1080,[324,720]],["mp4",1080,[864,1920]],["webm",1440,[1152,2560]]]) {
      const plan = wallpaperPlan(viewport, [-1200,-1200,1200,1200], camera, "current", format, resolution, display);
      assert.deepEqual([plan.width,plan.height], expected);
      assert(Math.abs(plan.view.width / plan.view.height - plan.width / plan.height) < 1e-12, "crop keeps streets in proportion");
      assert(plan.camera.x + plan.view.width / plan.camera.zoom / 2 <= 1200);
      assert(plan.camera.y - plan.view.height / plan.camera.zoom / 2 >= -1200);
    }
    assert.deepEqual(viewport, original);
  }
  assert.deepEqual(camera, before);
  const desktop = screenDimensions({width:1280,height:800}, 2);
  // A narrow window on a landscape monitor must not turn a wallpaper portrait.
  const plan = outputPlan({width:500,height:750,dpr:1.8}, "current", "mp4", 1080, desktop);
  assert.deepEqual([plan.width,plan.height], [1920,1200]);
  assert.deepEqual([outputPlan({width:500,height:750},"desktop","png",1080,display).width,
    outputPlan({width:500,height:750},"portrait","png",1080,desktop).height], [3840,1920]);
});

test("screen rounding, orientation, unavailable data and oversized displays remain bounded", () => {
  const view={width:411,height:794,dpr:1.8};
  const rounded=screenDimensions({width:411,height:914},2.625);
  const phone=outputPlan(view,"current","mp4",1080,rounded);
  assert.deepEqual([phone.width,phone.height],[864,1920]);
  const rotated=screenDimensions({width:432,height:960,orientation:{type:"landscape-primary"}},2.5);
  const landscape=outputPlan(view,"current","mp4",1080,rotated);
  assert.deepEqual([landscape.width,landscape.height],[1920,864]);
  const large=outputPlan(view,"current","png",1080,screenDimensions({width:7680,height:4320},2));
  assert.deepEqual([large.width,large.height],[3840,2160]);
  for(const display of [undefined,{width:0,height:900},{width:NaN,height:900},{width:411,height:Infinity}]) {
    const fallback=outputPlan(view,"current","png",1080,screenDimensions(display,2));
    assert.deepEqual([fallback.width,fallback.height],[740,1429]);
    assert.deepEqual(fallback.view,view);
  }
});

test("wallpaper and GIF crops preserve the visible world center without changing source viewport", () => {
  const source = { width: 1440, height: 1000, dpr: 1.8, quietMode: false, locale: "en" };
  const original = structuredClone(source);
  for (const [size, dims] of [["desktop", [3840, 2160]], ["portrait", [1080, 1920]]]) {
    const p = outputPlan(source, size, "png");
    assert.deepEqual([p.width, p.height], dims);
    // The same camera projects the visible center to the center of every target crop.
    assert(Math.abs((p.view.width / 2 - p.view.origin[0]) - (720 - 1440 * .63)) < 1e-9);
    assert(Math.abs(p.view.height / 2 - p.view.origin[1]) < 1e-9);
    assert(p.view.width <= source.width && p.view.height <= source.height);
    const gif = outputPlan(source, size, "gif");
    assert.equal(Math.max(gif.width, gif.height), 720);
    assert(Math.abs(gif.width / gif.height - p.width / p.height) < .002);
  }
  assert.deepEqual(source, original);
  const phone = { width: 390, height: 844, dpr: 1.8 };
  const plan = outputPlan(phone, "current", "png");
  assert.deepEqual(plan.view, phone); assert.deepEqual([plan.width, plan.height], [702, 1519]);
  assert.throws(() => outputPlan(source, "huge", "png"));
  assert.throws(() => cropView({ width: NaN, height: 10 }, 200, 200));
});

test("wallpaper fills the mapped rectangle without editor margins, stretch or camera mutation", () => {
  const view = { width: 1440, height: 1000, dpr: 1.8 }, bounds = [-1200, -1000, 1200, 1000];
  for (const center of [{ x: 0, y: 0, zoom: .1 }, { x: -2000, y: 1900, zoom: 2 }]) {
    const original = structuredClone(center);
    for (const size of ["current", "desktop", "portrait"]) for (const format of ["png", "gif", "mp4", "webm"]) {
      const p = wallpaperPlan(view, bounds, center, size, format), c = p.camera;
      const hx = p.view.width / (2 * c.zoom), hy = p.view.height / (2 * c.zoom);
      assert(c.x - hx >= bounds[0] && c.x + hx <= bounds[2]);
      assert(c.y - hy >= bounds[1] && c.y + hy <= bounds[3]);
      assert.deepEqual(p.view.origin, [p.view.width / 2, p.view.height / 2]);
      assert.equal(p.view.labels, false); assert.equal(p.view.vignette, false);
      // Preview interaction must not progressively zoom an already valid camera.
      assert.deepEqual(wallpaperPlan(view, bounds, c, size, format).camera, c);
      if (["mp4", "webm"].includes(format)) { assert.equal(Math.max(p.width, p.height), 1920); assert.equal(p.width % 2, 0); assert.equal(p.height % 2, 0); }
    }
    assert.deepEqual(center, original);
  }
  assert.throws(() => wallpaperPlan(view, [0, 0, 0, 1], { x: 0, y: 0, zoom: 1 }, "desktop", "png"));
});

test("clean composition contains no burned-in title or credit; source credit is explicit", () => {
  const text = [], ctx = { setTransform() {}, fillRect() {}, measureText: s => ({ width: s.length * 7 }), fillText: s => text.push(s) };
  const engine = { render() {}, data: { source: { attribution: "© OpenStreetMap contributors · ODbL" } } };
  const canvas = { getContext: () => ctx }, options = { width: 1080, height: 1920, view: { width: 1080, height: 1920 }, title: "Brand and city should not be burned in" };
  paintCapture(engine, canvas, options); assert.deepEqual(text, []);
  paintCapture(engine, canvas, { ...options, includeCredit: true });
  assert.deepEqual(text, [engine.data.source.attribution]);
});
