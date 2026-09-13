import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const kind=process.env.QA_BROWSER||'chromium',base=process.env.QA_URL||'http://127.0.0.1:5180/',out=process.env.QA_OUTPUT||'artifacts/landmarks';
await mkdir(out,{recursive:true});const browser=await pw[kind].launch({headless:true,...(kind==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const results={cities:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
 page.on('pageerror',e=>results.errors.push(e.message));
 await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__sceneQA={engine:()=>engine,snapshot:()=>engine.snapshot()};'});});
 for(const id of ['xinyi','ntu','tokyo','sapporo','shanghai','beijing','seattle','washington']){
  await page.goto(`${base}?landmarks=${id}#${id}`);await page.locator('#loading').waitFor({state:'hidden'});
  const record=await page.evaluate(async()=>{
   const {selectLandmarks,layoutLandmarkLabels}=await import('/src/landmarks.js'),{streetColorField}=await import('/src/street-colors.js');
   const e=window.__sceneQA.engine(),city=e.data.geometry,ctx=document.createElement('canvas').getContext('2d');ctx.font='12px "Microsoft JhengHei",sans-serif';
   const labels=layoutLandmarkLabels(city,e.camera,{width:innerWidth,height:innerHeight,locale:document.documentElement.lang},s=>ctx.measureText(s).width);
   return {id:city.id,selected:selectLandmarks(city).map(p=>p.name),visible:labels.map(p=>p.text),anchors:streetColorField(city).anchors.map(p=>({name:p.name,point:p.point,radius:p.radius}))};
  });assert(record.visible.length>0,id);assert(record.anchors.length<=3);results.cities.push(record);
  await page.screenshot({path:`${out}/${id}-en.png`});
  await page.click('#language');await page.screenshot({path:`${out}/${id}-zh.png`});
  await page.click('#export-options');assert.equal(await page.locator('#capture-labels').isChecked(),false);await page.locator('#capture-labels').evaluate(e=>e.closest('details').open=true);await page.check('#capture-labels');
  await page.selectOption('#capture-size','desktop1610');await page.waitForFunction(()=>!document.querySelector('#create-export').disabled);await page.click('#create-export');
  await page.locator('#export-dialog').waitFor({state:'visible'});const pending=page.waitForEvent('download');await page.click('#export-download');await(await pending).saveAs(`${out}/${id}-labels.png`);await page.click('#close-export');
 }
 results.paths=await page.evaluate(async()=>{
  const {renderAerial}=await import('/src/aerial.js');
  const types=['residential','service','footway','path','cycleway','steps'],roads=types.flatMap((highway,i)=>[false,true].map((unlit,j)=>({id:i*2+j,points:[[-150,i*40+j*15-120],[150,i*40+j*15-120]],tags:{highway,...(unlit?{lit:'no'}:{})}})));
  const atlas=renderAerial({bounds:[-200,-160,200,160],features:[],buildings:[],land:[],roads}),ctx=atlas.canvas.getContext('2d');
  const sample=(x,y)=>ctx.getImageData(Math.round((x+200)*atlas.resolution),Math.round((y+160)*atlas.resolution),1,1).data[0];
  const values=types.map((type,i)=>({type,lit:sample(0,i*40-120),unlit:sample(0,i*40+15-120)}));atlas.canvas.width=atlas.canvas.height=0;return values;
 });assert(results.paths.every(p=>p.lit>p.unlit),'Low-light traces must remain above the explicitly unlit baseline');
 await page.goto(`${base}?landmarks=phone&lang=zh-TW#tokyo`);await page.locator('#loading').waitFor({state:'hidden'});await page.setViewportSize({width:390,height:844});
 for(const palette of ['aerial','amber','blue']){
  await page.click(`[data-mood="${palette}"]`);await page.waitForTimeout(250);await page.screenshot({path:`${out}/phone-${palette}-zh.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 // Labels change presentation only; export remains clean until explicitly enabled.
 const before=await page.evaluate(()=>window.__sceneQA.snapshot());await page.click('#adjust');await page.uncheck('#landmark-labels');
 assert.deepEqual(await page.evaluate(()=>window.__sceneQA.snapshot().checkpoint),before.checkpoint);
 await page.check('#landmark-labels');assert.deepEqual(await page.evaluate(()=>window.__sceneQA.snapshot()),before);
 assert.deepEqual(results.errors,[]);await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({cities:results.cities.map(c=>({id:c.id,visible:c.visible,anchors:c.anchors.map(a=>a.name)})),paths:results.paths,errors:results.errors},null,2));
}finally{await browser.close();}
