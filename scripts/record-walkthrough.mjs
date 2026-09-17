import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const out = resolve(process.env.QA_OUTPUT || 'artifacts/newyork-walkthrough');
const base = process.env.QA_URL || 'http://127.0.0.1:5180/';
const query = 'city=newyork&lng=-74.012440&lat=40.707505&zoom=15.239&pitch=44.50&bearing=0.00&glow=1&density=700&lang=zh-TW&viewLabels=1&playing=1';
await mkdir(`${out}/frames`, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const frames = [], pending = [], errors = [], chapters = [];
let cdp, start;
const ffmpeg = args => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.error || r.status) throw r.error || Error(r.stderr); };
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.setDefaultTimeout(120000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}three.html?${query}`);
  await page.click('#tab-light');
  await page.selectOption('#quality', 'high');
  await page.click('#close-panel');
  const ready = () => page.waitForFunction(() => {
    const a = window.__lumen3d;
    return a?.stream?.ready && !a.stream.busy && a.map.areTilesLoaded() && !a.layer.stats.heightStatus.some(s => ['queued','running','pending'].includes(s));
  }, null, { timeout: 300000 });
  await ready();
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `#demo-caption{position:fixed;z-index:10000;top:26px;left:50%;transform:translateX(-50%);padding:10px 24px;border:1px solid #cfb77944;border-radius:10px;background:#07131cef;color:#eee5d3;text-align:center;font:20px/1.5 system-ui;pointer-events:none}#demo-caption small{display:block;color:#bdc8c7;font-size:14px}#demo-pointer{position:fixed;z-index:10001;width:18px;height:18px;border:2px solid #f9df9d;background:#07131c66;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;left:1000px;top:650px;box-shadow:0 0 0 4px #07131c66}`;
    document.head.append(style);
    for (const id of ['demo-caption','demo-pointer']) { const el=document.createElement('div'); el.id=id; document.body.append(el); }
    addEventListener('mousemove', e => { const p=document.querySelector('#demo-pointer');p.style.left=e.clientX+'px';p.style.top=e.clientY+'px'; });
    addEventListener('mousedown', () => { document.querySelector('#demo-pointer').style.background='#f9df9daa'; });
    addEventListener('mouseup', () => { document.querySelector('#demo-pointer').style.background='#07131c66'; });
  });
  const caption = async (zh,en) => {
    chapters.push({ seconds: start ? (Date.now()-start)/1000 : 0, zh, en });
    await page.locator('#demo-caption').evaluate((el,[a,b])=>{el.replaceChildren(document.createTextNode(a));const s=document.createElement('small');s.textContent=b;el.append(s)},[zh,en]);
  };
  const pause = ms => page.waitForTimeout(ms);
  async function move(x,y,ms=550){const steps=Math.ceil(ms/25);const p=await page.locator('#demo-pointer').evaluate(e=>{const b=e.getBoundingClientRect();return[b.x+b.width/2,b.y+b.height/2]});for(let i=1;i<=steps;i++){const t=i/steps;await page.mouse.move(p[0]+(x-p[0])*t,p[1]+(y-p[1])*t);await pause(25)}}
  async function click(selector){const l=page.locator(selector);await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();await move(b.x+b.width/2,b.y+b.height/2);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await pause(450)}
  async function select(selector,value){const l=page.locator(selector);await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();await move(b.x+b.width/2,b.y+b.height/2);await l.selectOption(value);await pause(500)}
  await caption('紐約・下曼哈頓', 'New York · Lower Manhattan');
  cdp=await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', event => {
    const file=`frame-${String(frames.length).padStart(5,'0')}.jpg`;
    frames.push({ file, timestamp: event.metadata.timestamp });
    pending.push(writeFile(`${out}/frames/${file}`,Buffer.from(event.data,'base64')));
    cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
  });
  start=Date.now();
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:1920,maxHeight:1080,everyNthFrame:1});
  await pause(2500);
  await page.screenshot({path:`${out}/poster.png`});
  await caption('拖曳，找到喜歡的視角', 'Drag to find your view');
  await move(920,560);await page.mouse.down();await move(1040,590,1500);await page.mouse.up();await pause(1600);
  await caption('開啟設定，辨認城市地標', 'Settings · Identify the landmarks');
  await click('#tab-light');await click('#view-landmark-labels');await pause(800);await click('#view-landmark-labels');await pause(1100);
  await caption('選擇桌布比例與尺寸', 'Capture · Choose a ratio and size');
  await click('#tab-capture');await select('#aspect','16:9');await select('#resolution','3840');await pause(1200);
  await caption('壓暗一側，為桌面圖示留白', 'Shade an edge to make room for icons');
  await click('details:has(#dim-side) > summary');await select('#dim-side','left');await pause(1300);
  await caption('加上城市名稱', 'Add a place title');
  await click('#place-label');await click('#place-text');await page.locator('#place-text').fill('');await page.locator('#place-text').pressSequentially('紐約・下曼哈頓',{delay:120});await select('#title-corner','bottom-right');await pause(1000);
  await caption('確認構圖', 'Preview the wallpaper');
  await click('#compose-full');await pause(2600);await click('#finish-frame');
  await caption('匯出 PNG', 'Export the wallpaper');
  await ready();
  const downloadEvent=page.waitForEvent('download');await click('#save');
  const download=await downloadEvent;await download.saveAs(`${out}/newyork-wallpaper.png`);
  await page.locator('#export-progress').waitFor({state:'hidden'});await pause(900);
  await caption('完成，放到你的桌面', 'Your wallpaper is ready');
  const png=await readFile(`${out}/newyork-wallpaper.png`);
  await page.evaluate(data=>{const img=document.createElement('img');img.src='data:image/png;base64,'+data;img.id='demo-result';img.style.cssText='position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#07131c;z-index:9999';document.body.append(img);document.querySelector('#demo-pointer').hidden=true},png.toString('base64'));
  await page.locator('#demo-result').evaluate(i=>i.decode());await pause(3500);
  await cdp.send('Page.stopScreencast');cdp.removeAllListeners('Page.screencastFrame');await Promise.all(pending);
  if(errors.length)throw Error(errors.join('\n'));
  if(frames.length<200)throw Error('Too few recorded frames');
  const timeline=frames.map((f,i)=>`file '${f.file}'\nduration ${i+1<frames.length?Math.max(0.001,frames[i+1].timestamp-f.timestamp):0.04}`).join('\n')+`\nfile '${frames.at(-1).file}'\n`;
  await writeFile(`${out}/frames/frames.txt`,timeline);
  // Skip the compositor's initial sizing frame. Keep the complete operation sequence.
  ffmpeg(['-f','concat','-safe','0','-i',`${out}/frames/frames.txt`,'-vf','fps=30','-ss','0.5','-c:v','libx264','-preset','slow','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart','-an',`${out}/newyork-walkthrough.mp4`]);
  const bytes=await readFile(`${out}/newyork-walkthrough.mp4`);
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',`${out}/newyork-walkthrough.mp4`],{encoding:'utf8'});
  if(probe.error || probe.status)throw probe.error || Error(probe.stderr);
  const seconds=Number(JSON.parse(probe.stdout).format.duration);
  await writeFile(`${out}/manifest.json`,JSON.stringify({source:'Actual browser interaction recording. Bilingual chapter captions and a pointer highlight added for the demonstration; the final image is the PNG downloaded during the recording.',cameraQuery:query,width:1920,height:1080,fps:30,quality:'high',capturedFrames:frames.length,seconds,chapters:chapters.map(c=>({...c,seconds:Math.max(0,c.seconds-0.5)})),errors,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
  console.log(`Recorded ${frames.length} frames; ${(bytes.length/1048576).toFixed(1)} MiB. Output: ${out}`);
} finally {
  await cdp?.send('Page.stopScreencast').catch(()=>{});
  await browser.close();
}
