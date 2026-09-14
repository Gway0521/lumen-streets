import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.QA_URL || 'http://127.0.0.1:5180/', output=process.env.QA_OUTPUT || 'artifacts/showcase';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const manifest={source:'Actual application downloads; no generated or retouched geography.',credit:'© OpenStreetMap contributors · ODbL',license:'https://www.openstreetmap.org/copyright',images:[]};
try {
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
  for(const id of ['sapporo','tokyo','shanghai','seattle','xinyi']) {
    // A full navigation avoids capturing the previous engine while a hash-only change loads.
    await page.goto(`${base}?showcase=${id}#${id}`);await page.locator('#loading').waitFor({state:'hidden'});
    await page.click('#export-options'); await page.selectOption('#capture-size', 'current'); await page.selectOption('#capture-format', 'png'); await page.click('#create-export');await page.locator('#export-dialog').waitFor({state:'visible'});
    const event=page.waitForEvent('download');await page.click('#export-download');await(await event).saveAs(`${output}/${id}.png`);await page.click('#close-export');
    manifest.images.push({id,file:`${id}.png`,width:1280,height:800,palette:'aerial',density:80,simulationTime:8});
  }
  await page.goto(`${base}?showcase=video#sapporo`);await page.locator('#loading').waitFor({state:'hidden'});
  await page.click('#export-options');await page.selectOption('#capture-format','mp4');await page.selectOption('#capture-size','desktop');await page.selectOption('#capture-duration','30');
  await page.waitForFunction(()=>!document.querySelector('#create-export').disabled);await page.click('#create-export');await page.locator('#export-dialog').waitFor({state:'visible',timeout:120000});
  const event=page.waitForEvent('download');await page.click('#export-download');await(await event).saveAs(`${output}/sapporo-source.mp4`);
  await writeFile(`${output}/manifest.json`,JSON.stringify(manifest,null,2));
}finally{await browser.close()}
