import { pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Render the same cover for the README animation and repository social preview.
// Requires Playwright, Chromium and FFmpeg; run against the built website.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = resolve(process.env.QA_OUTPUT || 'artifacts/social-preview');
const base = (process.env.QA_URL || 'http://127.0.0.1:5180/').replace(/\/?$/, '/');
const sourcePath = resolve(process.env.SOCIAL_VIDEO || 'public/gallery/sapporo.mp4');
const source = await readFile(sourcePath);
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr);
}
const fps = 10, seconds = 6, width = 960, height = 480;
await mkdir(out, { recursive: true });
const work = await mkdtemp(join(out, 'frames-'));
const frames = join(work, 'rendered'), sourceFrames = join(work, 'source');
await mkdir(frames);
await mkdir(sourceFrames);
ffmpeg(['-i', sourcePath, '-t', String(seconds), '-vf', `fps=${fps}`, '-start_number', '0', join(sourceFrames, '%03d.png')]);
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${base}fonts/titles.css"><style>
* { box-sizing: border-box; }
body { margin: 0; background: #07131c; color: #f4ecda; }
main { position: relative; width: 1280px; height: 640px; overflow: hidden; }
.city { position: absolute; width: 1280px; height: 800px; object-fit: cover; right: -160px; top: -40px; opacity: .84; }
.veil { position: absolute; inset: 0; background: linear-gradient(90deg, #07131c 0%, #07131cf0 24%, #07131c95 49%, #07131c10 83%), linear-gradient(0deg, #07131cdd, transparent 25%); }
.identity { position: absolute; left: 76px; top: 76px; }
.icon { width: 62px; height: 62px; border-radius: 16px; }
.eyebrow { font: 11px system-ui; letter-spacing: 3px; color: #d1b67d; margin: 24px 0 20px; }
h1 { font: 500 100px/.9 'Cormorant Garamond', serif; letter-spacing: -1px; margin: 0 0 26px; }
p { font: 21px/1.5 system-ui; color: #c0c9c6; margin: 0; max-width: 370px; }
.credit { position: absolute; bottom: 24px; right: 28px; font: 13px system-ui; color: #c2c7c1; }
.credit a { color: inherit; text-decoration: none; }
.place { position: absolute; left: 78px; bottom: 30px; font: 11px system-ui; letter-spacing: 2px; color: #a4b5b6; }
</style></head><body><main>
<img class="city" src="${base}cover-source/000.png">
<div class="veil"></div><div class="identity">
<img class="icon" src="${base}favicon.svg"><div class="eyebrow">OPEN-SOURCE NIGHTSCAPES</div>
<h1>Lumen<br>Streets</h1><p>Turn real streets into<br>living nightscapes.</p></div>
<div class="place">SAPPORO, JAPAN</div><div class="credit">Map data © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright">ODbL</a></div>
</main></body></html>`;
  await page.route('**/cover-source/*.png', async r => {
    const name = new URL(r.request().url()).pathname.split('/').at(-1);
    if (!/^\d{3}\.png$/.test(name)) throw Error('Invalid frame name');
    await r.fulfill({ contentType: 'image/png', body: await readFile(join(sourceFrames, name)) });
  });
  await page.route('**/social-cover', r => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(base + 'social-cover');
  await page.evaluate(async () => {
    await document.fonts.load('500 100px "Cormorant Garamond"', 'Lumen Streets');
    await Promise.all([...document.images].map(i => i.decode()));
  });
  for (let frame = 0; frame < fps * seconds; frame++) {
    await page.locator('.city').evaluate(async (img, url) => {
      img.src = url;
      await img.decode();
    }, `${base}cover-source/${String(frame).padStart(3, '0')}.png`);
    await page.screenshot({ path: join(frames, `${String(frame).padStart(3, '0')}.png`) });
    if (frame === 0) await page.screenshot({ path: join(out, 'social-left.jpg'), type: 'jpeg', quality: 94 });
  }
  if ((await readFile(join(frames, '000.png'))).equals(await readFile(join(frames, '059.png')))) {
    throw Error('Cover source has no visible motion.');
  }
  ffmpeg([
    '-framerate', String(fps), '-i', join(frames, '%03d.png'),
    '-filter_complex', `[0:v]scale=${width}:${height}:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    '-frames:v', String(fps * seconds), '-loop', '0', join(out, 'social-cover.gif')]);
  await writeFile(join(out, 'manifest.json'), JSON.stringify({
    source: 'Actual Sapporo application video with the shared logo, title and fixed gradient overlay. Six-second excerpt; repeats with a cut.',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    frames: fps * seconds, seconds, width, height,
    sha256: createHash('sha256').update(await readFile(join(out, 'social-cover.gif'))).digest('hex'),
  }, null, 2) + '\n');
  console.log('Created social-cover.gif (README) and social-left.jpg (1280×640 social preview).');
} finally {
  await browser.close();
}
