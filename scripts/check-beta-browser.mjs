import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const kind = process.env.BROWSER_TYPE || 'chromium', base = process.env.QA_URL || 'http://127.0.0.1:5180/';
const output = process.env.QA_OUTPUT || `artifacts/beta-${kind}`;
await mkdir(output, { recursive: true });
const browser = await pw[kind].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const results = { browser: kind, version: browser.version(), measurements: [], checks: [], errors: [] };
let currentPage;
const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)] ?? null;
try {
  for (const phone of [false, true]) {
    const label = phone ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport: phone ? {width:390,height:844} : {width:1440,height:1000}, deviceScaleFactor: phone ? 2 : 1,
      hasTouch: phone, ...(kind !== 'firefox' ? { isMobile: phone } : {}), reducedMotion: 'reduce', acceptDownloads: true });
    const page = await context.newPage(); page.on('pageerror', e => results.errors.push(e.message));
    currentPage=page;
    // Instrument dev responses only. No performance/debug globals ship in the application.
    await page.route('**/src/main.js*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + `
      const samples = []; const render = engine.render;
      SceneEngine.prototype.render = function(...args) { const start=performance.now(); const out=render.apply(this,args); if(this===engine)samples.push({at:start,ms:performance.now()-start}); return out; };
      window.__beta = { snapshot:()=>engine.snapshot(), samples, select, cache:()=>cities.size, engine:()=>engine, animation:()=>animation };
    ` }); });
    await page.addInitScript(() => { window.__longTasks=[];window.__longTasksSupported=PerformanceObserver.supportedEntryTypes?.includes('longtask');if(window.__longTasksSupported) new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true}); });
    for (const [index,id] of ['xinyi','ntu','tokyo','sapporo','shanghai','beijing','seattle','washington'].entries()) {
      const start=performance.now();
      if(index===0) { await page.goto(`${base}?lang=${phone?'zh-TW':'en'}#${id}`); await page.waitForFunction(()=>!!window.__beta); }
      else await page.evaluate(id=>window.__beta.select(id),id);
      const loadMs=performance.now()-start;
      await page.evaluate(()=>window.__beta.samples.length=0);
      await page.waitForTimeout(250); assert.equal(await page.evaluate(()=>window.__beta.samples.length),0, 'Paused editor must not repaint');
      assert.equal(await page.evaluate(()=>window.__beta.animation()),0);
      await page.click('#play'); await page.waitForTimeout(2000); await page.click('#play');
      const stats=await page.evaluate(()=>({samples:window.__beta.samples, heap:performance.memory?.usedJSHeapSize ?? null, cache:window.__beta.cache(), longTasks:window.__longTasks.splice(0), longTasksSupported:window.__longTasksSupported, canvas:[document.querySelector('#city').width,document.querySelector('#city').height]}));
      const gaps=stats.samples.slice(1).map((s,i)=>s.at-stats.samples[i].at);
      results.measurements.push({profile:label,id,loadMs:Math.round(loadMs),frames:stats.samples.length,renderP95:percentile(stats.samples.map(s=>s.ms),.95),frameGapP95:percentile(gaps,.95),heapBytes:stats.heap,cacheEntries:stats.cache,longTaskMax:stats.longTasksSupported?Math.max(0,...stats.longTasks.map(t=>t.ms)):null,canvas:stats.canvas});
      assert(stats.cache<=2); assert(stats.samples.length>5); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    const before=await page.evaluate(()=>window.__beta.snapshot());
    await page.setViewportSize(phone?{width:390,height:740}:{width:1480,height:1000});
    assert.deepEqual(await page.evaluate(()=>window.__beta.snapshot()),before,'Resize preserves camera and traffic');
    // Atlas failure must not change settings, URL, recipe or the current picture.
    const href=page.url(); await page.evaluate(()=>{ const engine=window.__beta.engine(); const original=engine.setPalette; engine.setPalette=()=>{throw Error('Allocation failed')}; window.__restorePalette=()=>engine.setPalette=original; });
    await page.click('[data-mood="blue"]'); assert.deepEqual(await page.evaluate(()=>window.__beta.snapshot()),before); assert.equal(page.url(),href); await page.evaluate(()=>window.__restorePalette());
    await page.click('#play');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await page.evaluate(()=>window.__beta.snapshot()); await page.waitForTimeout(300); assert.deepEqual(await page.evaluate(()=>window.__beta.snapshot()),hidden); assert.equal(await page.evaluate(()=>window.__beta.animation()),0);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));}); await page.waitForTimeout(150); assert((await page.evaluate(()=>window.__beta.snapshot())).simulationTime>hidden.simulationTime);
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.waitForTimeout(100); await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForFunction(()=>!window.__beta.snapshot().playing);
    const stable=await page.evaluate(()=>window.__beta.snapshot());
    await page.route('**/data/tokyo.json',route=>new Promise(resolve=>setTimeout(resolve,700)).then(()=>route.abort()).catch(()=>{}));
    await page.evaluate(async()=>{const native=window.setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,ms===30000?100:ms,...args);try{await window.__beta.select('tokyo')}finally{window.setTimeout=native}});
    assert.deepEqual(await page.evaluate(()=>window.__beta.snapshot()),stable);assert(await page.locator('#retry-map').isVisible());await page.click('#cancel-map');await page.unroute('**/data/tokyo.json');
    await page.screenshot({path:`${output}/${label}-ui.png`});
    await page.locator('#scene-menu').evaluate(e => e.open = true); await page.click('#share-scene'); const link=await page.locator('#scene-link').inputValue(); const saved=page.waitForEvent('download');await page.click('#download-scene');await(await saved).saveAs(`${output}/${label}.lumen.json`);await page.click('#close-scene'); await page.locator('#scene-menu').evaluate(e => e.open = false);
    // Real file creation, not just a preview element. Video availability remains runtime-dependent.
    for(const format of ['png','gif']) { await page.click('#export-options');await page.selectOption('#capture-format',format);await page.selectOption('#capture-size',phone?'portrait':'desktop');await page.click('#create-export');await page.locator('#export-dialog').waitFor({state:'visible',timeout:120000});const pending=page.waitForEvent('download');await page.click('#export-download');const file=await pending;await file.saveAs(`${output}/${label}.${format}`);assert.equal(await file.failure(),null);assert((await readFile(`${output}/${label}.${format}`)).length>1000);await page.click('#close-export'); }
    await page.click('#export-options');await page.selectOption('#capture-format','mp4');await page.waitForTimeout(1200);results.checks.push({profile:label,mp4Available:!(await page.locator('#create-export').isDisabled())});await page.keyboard.press('Escape');
    await page.goto(link);await page.waitForFunction(()=>!document.querySelector('#play').disabled);assert(await page.locator('#source-credit').isVisible());await page.click('#language');await page.screenshot({path:`${output}/${label}-player.png`});
    await page.goto(`${base}player.html`);await page.setInputFiles('#scene-file',`${output}/${label}.lumen.json`);await page.waitForFunction(()=>!document.querySelector('#play').disabled);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    results.checks.push({profile:label,pausedRafZero:true,resizePreserved:true,paletteFailureAtomic:true,backgroundStopped:true,reducedMotion:true,loadDeadlineRecovery:true,completeFileAndReference:true,actualPngAndGif:true});
    await context.close();
  }
  assert.deepEqual(results.errors,[]);
} catch(error) { results.failure=String(error);if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:`${output}/failure.png`});results.failureText=await currentPage.locator('body').innerText();}throw error;
} finally { await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));await browser.close(); }
console.log(JSON.stringify(results,null,2));
