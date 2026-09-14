import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const kind=process.env.QA_BROWSER||'chromium',out=process.env.QA_OUTPUT||'artifacts/projection-ui';await mkdir(out,{recursive:true});
const browser=await pw[kind].launch({headless:true,...(kind==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const results=[],errors=[];
try {
 for(const phone of [false,true])for(const locale of ['en','zh-TW']) {
  const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:phone?2:1,isMobile:phone,hasTouch:phone,reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/main.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:await r.text()+'\nwindow.__projectionQA={engine:()=>engine};'});});
  await page.goto((process.env.QA_URL||'http://127.0.0.1:5180/')+`?lang=${locale}#shanghai`);await page.locator('#loading').waitFor({state:'hidden'});
  await page.waitForFunction(()=>!!window.__projectionQA?.engine());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const label=`${phone?'phone':'desktop'}-${locale}`;
  await page.screenshot({path:`${out}/${label}.png`});
  await page.locator('#scene-menu').evaluate(e=>e.open=true);await page.click('#share-scene');
  assert(await page.locator('#reference-fields').isVisible());
  const saved=await page.evaluate(async()=>await(await fetch(document.querySelector('#download-scene').href)).text());
  assert.equal(JSON.parse(saved).recipe.structures.profiles.length,4);await page.click('#close-scene');
  // Create a true legacy recipe over the same source data, then use the actual file input.
  const legacy=await page.evaluate(async()=>{
    const {sceneFile}=await import('/src/scene/portable.ts'),{createStructures}=await import('/src/scene/structures.ts');
    const engine=window.__projectionQA.engine(),r=engine.snapshot();r.rendererVersion='aerial-7';r.structures=createStructures(engine.data,true);
    return await sceneFile(engine.data,r,{width:innerWidth,height:innerHeight}).text();
  });
  await page.setInputFiles('#import-scene',{name:'legacy.lumen.json',mimeType:'application/json',buffer:Buffer.from(legacy)});
  await page.waitForFunction(()=>window.__projectionQA.engine().legacyArtwork);
  const before=await page.evaluate(()=>window.__projectionQA.engine().snapshot());
  await page.locator('#scene-menu').evaluate(e=>e.open=true);await page.click('#upgrade-artwork');
  await page.waitForFunction(()=>!window.__projectionQA.engine().legacyArtwork);
  const after=await page.evaluate(()=>window.__projectionQA.engine().snapshot());
  assert.deepEqual(after.checkpoint,before.checkpoint);assert.deepEqual(after.camera,before.camera);
  assert.equal(after.structures.profiles.length,4);
  results.push({phone,locale,fileBytes:Buffer.byteLength(saved),legacyOpened:true,explicitUpgrade:true});await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({browser:browser.version(),results,errors},null,2));console.log(results);
}finally{await browser.close();}
