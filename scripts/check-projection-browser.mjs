import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const kind=process.env.QA_BROWSER||'chromium',out=process.env.QA_OUTPUT||'artifacts/projection';await mkdir(out,{recursive:true});
const browser=await pw[kind].launch({headless:true,...(kind==='chromium'?{channel:process.env.BROWSER_CHANNEL||'msedge'}:{})});
const report={browser:browser.version(),cases:[],errors:[]};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/projection-qa',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><canvas></canvas>'}));
  await page.goto((process.env.QA_URL||'http://127.0.0.1:5180/')+'projection-qa');
  report.aperture=await page.evaluate(async()=>{
    const {LANDMARK_PACK}=await import('/src/buildings/catalog.js'),{prepareBuildings,paintBuildings}=await import('/src/building-depth.js');
    const {sceneProjection,transformPoint}=await import('/src/engine/projection.js');
    const p=LANDMARK_PACK.profiles.find(p=>p.id==='shanghai-wfc'),settings={generator:2,projection:2,elevation:70};
    const f={id:10691100,sourceId:'way/10691100',assemblyId:'way/10691100',role:'body',tags:{building:'yes',wikidata:p.wikidata},points:[[-35,-35],[35,-35],[35,35],[-35,35],[-35,-35]],holes:[]};
    const b=prepareBuildings({center:p.anchor,buildings:[f]},()=>.5,[p],settings),cv=document.createElement('canvas');cv.width=cv.height=900;
    const c=cv.getContext('2d',{willReadFrequently:true}),{matrix,direction}=sceneProjection(settings);
    c.translate(650,700);c.scale(3,3);c.transform(...matrix,0,0);paintBuildings(c,b,()=>.5);
    const sample=z=>{const point=transformPoint(direction.map(v=>v*z),matrix);return c.getImageData(Math.round(650+point[0]*3),Math.round(700+point[1]*3),1,1).data[3];};
    const aperture=sample(460),body=sample(350);if(aperture!==0||body<240)throw Error(`Portal/body alpha: ${aperture}/${body}`);
    return {aperture,body};
  });
  for(const id of ['shanghai','xinyi','sapporo','tokyo']) {
    const result=await page.evaluate(async({id,baseline})=>{
      const {loadSceneData}=await import('/src/scene/data.ts'),{createRecipe}=await import('/src/scene/recipe.ts');
      const {SceneEngine}=await import('/src/engine/scene-engine.ts'),{renderAtlas}=await import('/src/city.js');
      const {sceneFile,readSceneFile,sceneReference,encodeReference,decodeReference}=await import('/src/scene/portable.ts');
      const {createStructures}=await import('/src/scene/structures.ts');
      const data=await loadSceneData(id),r=createRecipe(data);r.playing=false;r.camera={x:0,y:0,zoom:.55};
      const cv=document.querySelector('canvas');cv.width=1280;cv.height=800;const c=cv.getContext('2d');
      const view={width:1280,height:800,origin:[640,400],quietMode:true,labels:false,vignette:false};
      let stats;const start=performance.now(),engine=new SceneEngine(data,r,{atlas:(d,p,a,s)=>{
        const atlas=renderAtlas(d.geometry,p,a,s);stats={...atlas.structureStats,rgbaMiB:4*(atlas.canvas.width*atlas.canvas.height+atlas.foreground.width*atlas.foreground.height)/1048576};return atlas;
      }}),buildMs=performance.now()-start;
      engine.render(c,view);const wide=cv.toDataURL();
      const file=sceneFile(data,engine.snapshot(),view),read=await readSceneFile(file),reopened=new SceneEngine(read.data,read.recipe);
      reopened.render(c,view);if(cv.toDataURL()!==wide)throw Error(`${id}: reopen differs`);reopened.dispose();
      const fork=engine.fork();fork.render(c,view);if(cv.toDataURL()!==wide)throw Error(`${id}: capture differs`);fork.dispose();
      const link=encodeReference(sceneReference(data,engine.snapshot(),view)),reference=decodeReference(link);
      const linked=new SceneEngine(data,reference.recipe);linked.render(c,view);if(cv.toDataURL()!==wide)throw Error(`${id}: link differs`);linked.dispose();
      const frameStart=performance.now();for(let i=0;i<60;i++){engine.advance(.05);engine.render(c,view);}const frameMs=(performance.now()-frameStart)/60;
      engine.dispose();
      let legacyIdentical=null;
      if(baseline) {
        r.rendererVersion='aerial-7';r.structures=createStructures(data,true);
        const old=new SceneEngine(data,r);old.render(c,view);const pixels=cv.toDataURL();old.dispose();
        const {SceneEngine:OldEngine}=await import(baseline+'/src/engine/scene-engine.ts');
        const previous=new OldEngine(data,r);previous.render(c,view);legacyIdentical=pixels===cv.toDataURL();previous.dispose();
        if(!legacyIdentical)throw Error(`${id}: legacy view changed`);
      }
      return {id,buildMs,frameMs,stats,linkBytes:link.length,fileBytes:file.size,legacyIdentical,wide};
    },{id,baseline:process.env.QA_BASELINE||null});
    await writeFile(`${out}/${id}.png`,Buffer.from(result.wide.split(',')[1],'base64'));delete result.wide;report.cases.push(result);
  }
  assert.deepEqual(report.errors,[]);await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
