import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const kind=process.env.QA_BROWSER||'chromium',out=process.env.QA_OUTPUT||'artifacts/landmarks';
await mkdir(out,{recursive:true});
const browser=await pw[kind].launch({headless:true,...(kind==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const errors=[],report={browser:browser.version(),scenes:[]};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.QA_URL||'http://127.0.0.1:5180/');
  await page.locator('#loading').waitFor({state:'hidden'});
  report.openStructure=await page.evaluate(async()=>{
    const {prepareBuildings,paintBuildings}=await import('/src/building-depth.js');
    const {LANDMARK_PACK}=await import('/src/buildings/catalog.js');
    const profile=LANDMARK_PACK.profiles[1];
    const feature={id:199758828,sourceId:'way/199758828',tags:{building:'public',wikidata:profile.wikidata},
      points:[[-15,-15],[15,-15],[15,15],[-15,15],[-15,-15]],holes:[]};
    const city={center:profile.anchor,buildings:[feature]};
    const b=prepareBuildings(city,()=>.5,[profile]),canvas=document.createElement('canvas');canvas.width=canvas.height=400;
    const c=canvas.getContext('2d',{willReadFrequently:true});c.translate(200,280);c.scale(3,3);paintBuildings(c,b,()=>.5);
    const pixels=c.getImageData(125,150,90,90).data;let clear=0,solid=0;
    for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)clear++;if(pixels[i]>200)solid++;}
    if(clear<2000||solid<100)throw Error('Lattice silhouette lost its openings or structure');
    canvas.width=canvas.height=0;return {clearPixels:clear,solidPixels:solid};
  });
  for(const id of ['xinyi','sapporo']) {
    const result=await page.evaluate(async id=>{
      const {loadSceneData}=await import('/src/scene/data.ts');
      const {createRecipe}=await import('/src/scene/recipe.ts');
      const {SceneEngine}=await import('/src/engine/scene-engine.ts');
      const {sceneFile,readSceneFile,sceneReference,encodeReference,decodeReference}=await import('/src/scene/portable.ts');
      const {renderAtlas,project}=await import('/src/city.js');
      const data=await loadSceneData(id),recipe=createRecipe(data);
      recipe.playing=false;recipe.appearance.labels=false;
      let stats;
      const start=performance.now();
      const engine=new SceneEngine(data,recipe,{atlas:(d,p,a,s)=>{const atlas=renderAtlas(d.geometry,p,a,s);stats={...atlas.structureStats,dimensions:[atlas.foreground.width,atlas.foreground.height]};return atlas;}});
      const atlasMs=performance.now()-start;
      const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;
      const ctx=canvas.getContext('2d'),view={width:1600,height:1000,origin:[800,500],quietMode:true,labels:false,vignette:false};
      engine.setCamera({x:0,y:0,zoom:.62});engine.render(ctx,view);const wide=canvas.toDataURL();
      const profile=recipe.structures.profiles[0],anchor=project(...profile.anchor,data.geometry.center);
      const camera={x:anchor[0]-.16*profile.height,y:anchor[1]-.24*profile.height,zoom:id==='xinyi'?2.6:5.8};
      engine.setCamera(camera);engine.render(ctx,view);const close=canvas.toDataURL();
      const fork=engine.fork();fork.render(ctx,view);if(canvas.toDataURL()!==close)throw Error('Fork artwork changed');fork.dispose();
      const saved=sceneFile(data,engine.snapshot(),view),read=await readSceneFile(saved);
      const reopened=new SceneEngine(read.data,read.recipe);reopened.render(ctx,view);
      if(canvas.toDataURL()!==close)throw Error('Saved landmark artwork changed');reopened.dispose();
      const link=encodeReference(sceneReference(data,engine.snapshot(),view));
      if(JSON.stringify(decodeReference(link).recipe.structures)!==JSON.stringify(recipe.structures))throw Error('Link lost landmark settings');
      const frameStart=performance.now();for(let i=0;i<60;i++){engine.advance(.05);engine.render(ctx,view);}
      const frameMs=(performance.now()-frameStart)/60;
      engine.dispose();canvas.width=canvas.height=0;
      return {id,atlasMs,frameMs,stats,profile:profile.id,height:profile.height,linkBytes:link.length,savedBytes:saved.size,wide,close};
    },id);
    for(const name of ['wide','close']){await writeFile(`${out}/${id}-${name}.png`,Buffer.from(result[name].split(',')[1],'base64'));delete result[name];}
    report.scenes.push(result);
  }
  report.errors=errors;assert.deepEqual(errors,[]);
  await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
