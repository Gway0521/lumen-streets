import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { presets } from '../src/three/presets.js';

const base = process.env.QA_URL || 'http://127.0.0.1:5180/';
const output = process.env.QA_OUTPUT || 'artifacts/showcase';
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = async () => {
    await page.waitForFunction(() => {
      const app = window.__lumen3d;
      return app ? app.stream?.ready && !app.stream.busy : !document.querySelector('#save')?.disabled;
    });
    await page.locator('#save').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
  };
  async function capture(format, file) {
    await page.selectOption('#format', format);
    await ready();
    const event = page.waitForEvent('download', { timeout: 300000 });
    await page.click('#save');
    const download = await event;
    await download.saveAs(file);
    await page.locator('#export-progress').waitFor({ state: 'hidden' });
  }
  for (const id of Object.keys(presets)) {
    await page.goto(`${base}?city=${id}&playing=0&lang=en`);
    await page.click('#tab-capture');
    await page.selectOption('#aspect', '16:9');
    await page.selectOption('#resolution', '1920');
    const source = `${output}/${id}-source.png`, file = `${output}/${id}.png`;
    await capture('png', source);
    convert(['-i', source, '-vf', 'scale=1280:720:flags=lanczos', '-frames:v', '1', file]);
    manifest.images.push({ id, file: `${id}.png`, width: 1280, height: 720,
      camera: presets[id], sha256: await hash(file),
      state: await page.evaluate(() => window.__lumen3d?.layer.stats || null) });
    console.log(`Captured ${id}`);
  }
  await page.goto(`${base}?city=sapporo&playing=0&lang=en`);
  await page.click('#tab-capture');
  await page.selectOption('#aspect', '16:9');
  await page.selectOption('#format', 'video');
  await page.selectOption('#duration', '30');
  const video = `${output}/sapporo-source.mp4`;
  await capture('video', video);
  convert(['-i', video, '-t', '12', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${output}/sapporo.mp4`]);
  convert(['-i', `${output}/sapporo.mp4`, '-frames:v', '1', `${output}/video-poster.png`]);
  manifest.recording = { file: 'sapporo.mp4', seconds: 12, frames: 360, width: 1280, height: 720, codec: 'H.264',
    source: 'First 12 seconds of a 30-second application export, resized and compressed with FFmpeg.', sourceSha256: await hash(video), sha256: await hash(`${output}/sapporo.mp4`) };
  manifest.poster = { file: 'video-poster.png', width: 1280, height: 720, source: 'First decoded video frame.', sha256: await hash(`${output}/video-poster.png`) };
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
}
