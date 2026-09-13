import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const kind=process.env.QA_BROWSER||'chromium',out=process.env.QA_OUTPUT||'artifacts/art',base=process.env.QA_URL||'http://127.0.0.1:5180/';
await mkdir(out,{recursive:true});
const browser=await pw[kind].launch({headless:true,...(kind==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
const errors=[],result={browser:browser.version(),checks:[],files:[]};page.on('pageerror',e=>errors.push(e.message));
async function ready(){await page.locator('#loading').waitFor({state:'hidden'});}
async function options(){await page.click('#export-options');await page.waitForFunction(()=>!document.querySelector('#create-export').disabled);}
async function details(id){await page.locator(id).evaluate(e=>e.closest('details').open=true);}
async function download(name){
 await page.waitForFunction(()=>!document.querySelector('#create-export').disabled);
 await page.click('#create-export');await page.locator('#export-dialog').waitFor({state:'visible',timeout:120000});
 const pending=page.waitForEvent('download');await page.click('#export-download');const file=await pending;
 assert.equal(await file.failure(),null);await file.saveAs(`${out}/${name}`);result.files.push(name);
 await page.click('#close-export');
}
async function layout(label){
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#create-export').scrollIntoViewIfNeeded();
 const rect=await page.locator('#create-export').boundingBox();assert(rect.y>=0&&rect.y+rect.height<=(await page.viewportSize()).height);
 await page.screenshot({path:`${out}/${label}.png`});
}
try{
 await page.goto(base+'#sapporo');await ready();await options();
 assert.equal(await page.locator('#capture-quiet-edge').inputValue(),'none');
 assert.equal(await page.locator('#capture-place-title').isChecked(),false);
 if(!process.env.QA_PRODUCTION){
  result.pixels=await page.evaluate(async()=>{
   const {paintQuietSpace,paintPlaceTitle}=await import('/src/export/png.ts');
   const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;const ctx=canvas.getContext('2d');
   const sample=(x,y)=>ctx.getImageData(x,y,1,1).data[0],fill=()=>{ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1000,1000);};
   const values={};
   for(const edge of ['none','left','right','top','bottom']){
    fill();paintQuietSpace(ctx,1000,1000,{edge,strength:.75});
    const samples=[0,100,250,500,650,999].map(p=>sample(edge==='right'?999-p:edge==='left'||edge==='none'?p:500,edge==='bottom'?999-p:edge==='top'?p:500));
    if(edge==='none'&&!samples.every(v=>v===255))throw Error('Default changed pixels');
    if(edge!=='none'&&(!samples.every((v,i)=>!i||v>=samples[i-1])||samples[0]>80||samples[4]!==255))throw Error('Fade discontinuity or wrong direction');
    values[edge]=samples;
   }
   // A title must restore transform/alpha and fit above credit even at a long portrait title.
   ctx.setTransform(2,0,0,2,0,0);const before=ctx.getTransform().toString();
   paintPlaceTitle(ctx,1080,1920,{text:'臺北 Taipei '.repeat(10),corner:'bottom-right',size:'large'},1820);
   if(ctx.getTransform().toString()!==before||ctx.globalAlpha!==1)throw Error('Caption leaked painter state');
   return values;
  });
 }
 await page.selectOption('#capture-size','desktop1610');await details('#capture-place-title');await page.check('#capture-place-title');
 await page.fill('#capture-title-text','Sapporo · Hokkaido');await page.selectOption('#capture-title-corner','bottom-right');
 await download('caption-en.png');
 await options();await details('#capture-quiet-edge');await page.selectOption('#capture-quiet-edge','left');
 await page.locator('#capture-quiet-strength').press('Home');await page.waitForFunction(()=>document.querySelector('#quiet-strength-value').value==='0%');
 const lightPreview=await page.locator('#capture-preview').evaluate(c=>c.toDataURL());
 await page.locator('#capture-quiet-strength').press('End');await page.waitForFunction(()=>document.querySelector('#quiet-strength-value').value==='100%');
 assert.notEqual(await page.locator('#capture-preview').evaluate(c=>c.toDataURL()),lightPreview);
 await page.locator('#capture-quiet-strength').evaluate(e=>{e.value='75';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await layout('desktop-en');await download('quiet-left.png');
 await page.click('#language');await options();await page.fill('#capture-title-text','札幌 · 北海道');
 await page.selectOption('#capture-quiet-edge','right');await page.selectOption('#capture-title-corner','bottom-left');await download('quiet-right-zh.png');
 for(const corner of ['top-left','top-right','bottom-left','bottom-right']){
  await options();await page.selectOption('#capture-size','portrait');await page.selectOption('#capture-title-corner',corner);
  await page.fill('#capture-title-text','臺北 Taipei · 夜間街道與城市記憶 '.repeat(5).slice(0,120));await page.check('#capture-credit');
  await page.selectOption('#capture-quiet-edge','top');await download(`long-${corner}.png`);
 }
 await page.setViewportSize({width:390,height:844});await options();await page.fill('#capture-title-text','札幌 · 北海道');await page.uncheck('#capture-credit');
 await page.selectOption('#capture-title-corner','bottom-right');await layout('phone-zh');await download('phone-top-zh.png');
 await page.click('#language');await options();await page.selectOption('#capture-quiet-edge','bottom');await layout('phone-en');
 await page.setViewportSize({width:844,height:390});await layout('phone-landscape-en');await page.click('#close-capture');
 await page.setViewportSize({width:1440,height:1000});await options();await page.selectOption('#capture-size','desktop1610');
 await page.fill('#capture-title-text','Sapporo · Hokkaido');await page.selectOption('#capture-quiet-edge','left');
 await page.selectOption('#capture-format','gif');await download('quiet.gif');
 if(kind==='chromium')for(const format of ['mp4','webm']){
  await options();await page.selectOption('#capture-format',format);await page.selectOption('#capture-duration','custom');
  await page.fill('#capture-seconds','15');await download(`quiet.${format}`);
 }
 // Explicitly disabling the effect is visible immediately, including after a format change.
 await options();await page.selectOption('#capture-format','png');await page.selectOption('#capture-quiet-edge','none');await page.uncheck('#capture-place-title');
 assert(await page.locator('#quiet-strength-control').isHidden());await page.click('#close-capture');
 await page.goto(base+'player.html');await page.locator('.player-bar img').evaluate(i=>i.decode());
 await page.screenshot({path:`${out}/player-logo.png`});
 result.checks.push('Four fade directions, default off, caption corners/long bilingual text with credit, desktop/phone/short landscape, real PNG/GIF and available video files, shared logo');
 assert.deepEqual(errors,[]);result.errors=errors;await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
