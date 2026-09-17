import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { presets } from '../src/three/presets.js';

// Use the development server so captures can wait for the actual city geometry.
const base = process.env.QA_URL || 'http://127.0.0.1:5180/';
const shanghai = 'city=shanghai&lng=121.491646&lat=31.242127&zoom=15.139&pitch=55.00&bearing=0.00&glow=1&density=700&viewLabels=1';
const output = process.env.QA_OUTPUT || 'artifacts/showcase-hq';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = { applicationVersion: pkg.version, rendererVersion: 'three',
  source: 'Application exports with map data, estimated building heights and original landmark artwork.',
  credit: '© OpenStreetMap contributors · Overture Maps · height-source credits appear in each export',
  license: 'https://www.openstreetmap.org/copyright', images: [] };
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
function convert(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.error || result.status) throw result.error || Error(result.stderr);
}
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, acceptDownloads: true });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = async () => {
    await page.waitForFunction(() => {
      const app = window.__lumen3d;
      return app?.stream?.ready && !app.stream.busy && app.map.areTilesLoaded();
    }, undefined, { timeout: 300000 });
    await page.waitForFunction(() => !window.__lumen3d.layer.stats.heightStatus.some(s => ['queued', 'running', 'pending'].includes(s)), undefined, { timeout: 300000 });
    await page.locator('#save').waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);
  };
  async function capture(format, file) {
    await page.selectOption('#format', format);
    await ready();
    const event = page.waitForEvent('download', { timeout: 1800000 });
    await page.click('#save');
    const download = await event;
    await download.saveAs(file);
    await page.locator('#export-progress').waitFor({ state: 'hidden' });
  }
  async function open(query, locale = 'en') {
    await page.goto(`${base}?${query}&playing=0&lang=${locale}`);
    await page.click('#tab-light');
    await page.selectOption('#quality', 'high');
    await page.click('#tab-capture');
    await page.selectOption('#aspect', '16:9');
    await ready();
    console.log('Ready', query, await page.evaluate(() => window.__lumen3d.layer.stats.heightStatus));
  }
  const selected = process.env.SHOWCASE_ONLY?.split(',');
  for (const id of Object.keys(presets).filter(id => !selected || selected.includes(id))) {
    await open(`city=${id}`);
    await page.selectOption('#resolution', '3840');
    const source = `${output}/${id}-source.png`, file = `${output}/${id}.webp`;
    await capture('png', source);
    convert(['-i', source, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-frames:v', '1', file]);
    convert(['-i', source, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libwebp', '-lossless', '1', '-frames:v', '1', `${output}/${id}-preview.webp`]);
    manifest.images.push({ id, file: `${id}.webp`, width: 3840, height: 2160, quality: 'high', encoding: 'lossless WebP',
      camera: presets[id], sha256: await hash(file),
      preview: { file: `${id}-preview.webp`, width: 1280, height: 720, sha256: await hash(`${output}/${id}-preview.webp`) },
      state: await page.evaluate(() => window.__lumen3d?.layer.stats || null) });
    console.log(`Captured ${id}`);
  }
  if (!selected || selected.includes('wallpaper')) {
    await open(shanghai, 'zh-TW');
    await page.selectOption('#resolution', '3840');
    await page.locator('details').filter({ has: page.locator('#dim-side') }).locator('summary').click();
    await page.selectOption('#dim-side', 'left');
    await page.locator('#dim-brightness').fill('12');
    await page.locator('#dim-area').fill('48');
    await page.check('#place-label');
    await page.fill('#place-text', '上海・黃浦江');
    await page.selectOption('#title-corner', 'bottom-right');
    await capture('png', `${output}/shanghai-wallpaper.png`);
    convert(['-i', `${output}/shanghai-wallpaper.png`, '-vf', 'scale=1920:1080:flags=lanczos', '-q:v', '2', '-frames:v', '1', `${output}/shanghai-wallpaper.jpg`]);
    manifest.wallpaper = { file: 'shanghai-wallpaper.png', width: 3840, height: 2160, quality: 'high', cameraQuery: shanghai, sha256: await hash(`${output}/shanghai-wallpaper.png`) };
  }
  for (const id of ['sapporo', 'shanghai']) {
    if (selected && !selected.includes(`${id}-video`)) continue;
    await open(id === 'shanghai' ? shanghai : 'city=sapporo', id === 'shanghai' ? 'zh-TW' : 'en');
    await page.selectOption('#format', 'video');
    await page.selectOption('#resolution', '2560');
    await page.selectOption('#duration', '30');
    const video = `${output}/${id}-source.mp4`;
    console.log(`Recording ${id} at 2560×1440`);
    await capture('video', video);
    if (id === 'shanghai') continue;
    convert(['-i', video, '-t', '12', '-c:v', 'copy', '-movflags', '+faststart', `${output}/sapporo.mp4`]);
    convert(['-i', `${output}/sapporo.mp4`, '-frames:v', '1', `${output}/video-poster.png`]);
    manifest.recording = { file: 'sapporo.mp4', seconds: 12, frames: 360, width: 2560, height: 1440, quality: 'high', codec: 'H.264',
      source: 'First 12 seconds of a 30-second application export, trimmed without re-encoding.', sourceSha256: await hash(video), sha256: await hash(`${output}/sapporo.mp4`) };
    manifest.poster = { file: 'video-poster.png', width: 2560, height: 1440, source: 'First decoded video frame.', sha256: await hash(`${output}/video-poster.png`) };
  }
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
}
