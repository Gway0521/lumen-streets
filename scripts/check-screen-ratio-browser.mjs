import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const kind = process.env.BROWSER_TYPE || 'chromium', base = process.env.QA_URL || 'http://127.0.0.1:5180/';
const output = process.env.QA_OUTPUT || 'artifacts/screen-ratio';
await mkdir(output, { recursive: true });
const browser = await pw[kind].launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
const results = [], errors = [];
try {
  for (const phone of [false,true]) for (const lang of ['en','zh-TW']) {
    const profile = `${phone?'phone':'desktop'}-${lang}`;
    const context = await browser.newContext({viewport:phone?{width:432,height:810}:{width:1180,height:680},screen:phone?{width:432,height:960}:{width:1280,height:800},deviceScaleFactor:phone?2.5:2,isMobile:phone,hasTouch:phone,reducedMotion:'reduce',acceptDownloads:true});
    // Playwright's viewport resize also changes its emulated screen. Keep this
    // browser API fixture independent, as on a real fixed-size monitor/phone.
    await context.addInitScript(({width,height})=>{
      let display={width,height}; const orientation=new EventTarget();
      Object.defineProperty(screen,'width',{get:()=>display.width});
      Object.defineProperty(screen,'height',{get:()=>display.height});
      Object.defineProperty(orientation,'type',{get:()=>display.width>display.height?'landscape-primary':'portrait-primary'});
      Object.defineProperty(screen,'orientation',{value:orientation});
      window.__rotateDisplay=(width,height)=>{display={width,height};orientation.dispatchEvent(new Event('change'));};
    },phone?{width:432,height:960}:{width:1280,height:800});
    const page = await context.newPage(); page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`${base}?lang=${lang}#sapporo`);
    await page.locator('#loading').waitFor({state:'hidden'});
    await page.click('#export-options');
    const dimensions = page.locator('#capture-dimensions');
    const expect = async value => assert.equal(await dimensions.textContent(), value);
    await page.waitForFunction(()=>document.querySelector('#capture-dimensions').textContent.endsWith('PNG'));
    await expect(phone?'1080 × 2400 PNG':'2560 × 1600 PNG');
    // Changing the browser's usable height must not change its full screen ratio.
    await page.setViewportSize(phone?{width:432,height:740}:{width:1000,height:680});
    await expect(phone?'1080 × 2400 PNG':'2560 × 1600 PNG');
    await page.selectOption('#capture-format','mp4');
    await page.waitForFunction(()=>document.querySelector('#capture-dimensions').textContent.endsWith('MP4'));
    await expect(phone?'864 × 1920 MP4':'1920 × 1200 MP4');
    await page.selectOption('#capture-resolution','1440');
    await page.waitForFunction(()=>document.querySelector('#capture-dimensions').textContent.includes('2560'));
    await expect(phone?'1152 × 2560 MP4':'2560 × 1600 MP4');
    await page.selectOption('#capture-format','png');
    await page.waitForFunction(()=>!document.querySelector('#create-export').disabled);
    await page.screenshot({path:`${output}/${profile}-preview.png`});
    await page.click('#create-export');
    await page.locator('#export-dialog').waitFor({state:'visible'});
    await page.locator('#export-image').evaluate(img=>img.decode());
    const pending = page.waitForEvent('download'); await page.click('#export-download');
    const download = await pending; await download.saveAs(`${output}/${profile}.png`); assert.equal(await download.failure(),null);
    const bytes=await readFile(`${output}/${profile}.png`), size=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
    assert.deepEqual(size,phone?[1080,2400]:[2560,1600]);
    await page.screenshot({path:`${output}/${profile}-result.png`});
    await page.click('#close-export');
    if (phone) {
      await page.click('#export-options');
      await page.evaluate(()=>window.__rotateDisplay(960,432));
      await page.setViewportSize({width:810,height:432});
      await page.waitForFunction(()=>document.querySelector('#capture-dimensions').textContent==='2400 × 1080 PNG');
      await page.screenshot({path:`${output}/${profile}-rotated.png`});
    }
    results.push({profile,png:size,video1080:phone?[864,1920]:[1920,1200],video1440:phone?[1152,2560]:[2560,1600],viewportResizePreservedRatio:true,rotationChecked:phone});
    console.log(JSON.stringify(results.at(-1))); await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {await writeFile(`${output}/results.json`,JSON.stringify({browser:kind,version:browser.version(),results,errors},null,2));await browser.close();}
