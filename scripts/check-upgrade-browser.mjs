import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = process.env.QA_OUTPUT || 'artifacts/upgrade', base = process.env.QA_URL || 'http://127.0.0.1:5180/';
await fs.mkdir(out, { recursive: true });
let browser;
const results = { checks: [], videos: [], errors: [] };
const waitReady = async (p) => p.waitForFunction(() => document.querySelector('#loading')?.hidden && document.querySelector('#map-load').hidden);
const download = async (p, id, name) => { const event = p.waitForEvent('download'); await p.click(id); const d = await event; await d.saveAs(`${out}/${name}`); return (await fs.stat(`${out}/${name}`)).size; };
const scene = async (p) => { await p.locator('#scene-menu').evaluate(e => e.open = true); await p.click('#share-scene'); const value = await p.evaluate(async () => (await fetch(document.querySelector('#download-scene').href)).json()); await p.click('#close-scene'); await p.locator('#scene-menu').evaluate(e => e.open = false); return value; };
const storageCount = async (p) => p.evaluate(async () => { const root = await navigator.storage.getDirectory(); try {
    const d = await root.getDirectoryHandle('lumen-streets-exports');
    let n = 0;
    for await (const key of d.keys())
        if (key.startsWith('capture-'))
            n++;
    return n;
}
catch {
    return 0;
} });
const closeResult = async (p) => { await p.click('#close-export'); await p.waitForFunction(async () => { try {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('lumen-streets-exports');
    for await (const k of d.keys())
        if (k.startsWith('capture-'))
            return false;
}
catch { } return true; }); };
let current;
try {
    for (const phone of [false, true]) {
        const label = phone ? 'phone' : 'desktop', context = await chromium.launchPersistentContext(path.resolve(out, 'profiles', label + '-' + Date.now()), { headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge', args: process.env.QA_DEBUG_PORT ? [`--remote-debugging-port=${process.env.QA_DEBUG_PORT}`] : [], viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce', acceptDownloads: true }), p = await context.newPage();
        browser = context.browser();
        current = p;
        p.on('console', m => { if (m.type() === 'error')
            console.log(m.text()); });
        p.on('pageerror', e => results.errors.push(e.message));
        await p.addInitScript(() => { const original = FileSystemFileHandle.prototype.createWritable; FileSystemFileHandle.prototype.createWritable = async function (...args) { if (window.failStorage === 'create')
            throw new DOMException('QA full storage', 'QuotaExceededError'); const stream = await original.apply(this, args); return window.failStorage === 'write' ? new WritableStream({ async write() { await stream.abort(); throw new DOMException('QA write quota', 'QuotaExceededError'); }, abort() { return stream.abort(); } }) : stream; }; });
        await p.goto(base + '?lang=' + (phone ? 'zh-TW' : 'en') + '#sapporo');
        await waitReady(p);
        assert.equal(await p.locator('#save').count(), 0);
        assert(await p.locator('#export-options').isVisible());
        await p.focus('#place-select');
        assert.equal(await p.locator('#place-select').evaluate(e => getComputedStyle(e).outlineOffset), '-3px');
        await p.screenshot({ path: `${out}/${label}-home.png` });
        if (!phone && process.env.QA_ART === '1')
            for (const id of ['xinyi', 'ntu', 'tokyo', 'sapporo', 'shanghai', 'beijing', 'seattle', 'washington']) {
                await p.evaluate(id => document.querySelector('#place-select').onchange({ target: { value: id } }), id);
                await p.click('#about');
                await p.click('#save-study');
                await p.waitForFunction(() => document.querySelector('#export-dialog').open);
                await download(p, '#export-download', id + '-study.png');
                await closeResult(p);
            }
        const before = await scene(p);
        await p.click('#adjust');
        for (const [id, value] of [['brightness', 85], ['glow', 140], ['district', 60]])
            await p.locator('#' + id).evaluate((e, value) => { e.value = value; e.dispatchEvent(new Event('change')); }, value);
        await p.uncheck('#landmark-labels');
        await p.screenshot({ path: `${out}/${label}-adjust.png` });
        await p.click('#close-adjust');
        const changed = await scene(p);
        assert.deepEqual(changed.recipe.appearance, { version: 1, brightness: .85, glow: 1.4, district: .6, labels: false });
        assert.deepEqual(before.recipe.checkpoint, changed.recipe.checkpoint);
        await p.setInputFiles('#import-scene', { name: 'appearance.lumen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
        await waitReady(p);
        assert.deepEqual((await scene(p)).recipe, changed.recipe);
        const legacy = structuredClone(changed);
        legacy.recipe.rendererVersion = 'aerial-1';
        delete legacy.recipe.appearance;
        await p.setInputFiles('#import-scene', { name: 'legacy.lumen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
        await waitReady(p);
        assert.deepEqual((await scene(p)).recipe.appearance, { version: 1, brightness: 1, glow: 1, district: 1, labels: true });
        const beforePng = await scene(p);
        await p.click('#export-options');
        await p.selectOption('#capture-size', 'portrait');
        await p.locator('.export-details').evaluate(e => e.open = true);
        await p.check('#capture-place-title');
        await p.fill('#capture-title-text', phone ? '札幌 · 北海道' : 'Sapporo · Hokkaido');
        await p.selectOption('#capture-title-corner', 'bottom-right');
        await p.check('#capture-credit');
        await p.screenshot({ path: `${out}/${label}-title-preview.png` });
        await p.click('#create-export');
        await p.waitForFunction(() => document.querySelector('#export-dialog').open);
        await download(p, '#export-download', `${label}-title.png`);
        await closeResult(p);
        assert.deepEqual((await scene(p)).recipe, beforePng.recipe);
        await p.click('#export-options');
        await p.uncheck('#capture-credit');
        await p.selectOption('#capture-format', 'gif');
        await p.click('#create-export');
        await p.waitForFunction(() => document.querySelector('#export-dialog').open);
        await download(p, '#export-download', `${label}-title.gif`);
        await closeResult(p);
        for (const [format, resolution, seconds, size] of (phone ? [['mp4', 1440, 60, 'portrait'], ['webm', 1080, 300, 'portrait']] : [['mp4', 1440, 300, 'desktop'], ['webm', 1440, 91, 'desktop']])) {
            await p.click('#export-options');
            await p.selectOption('#capture-format', format);
            await p.selectOption('#capture-resolution', String(resolution));
            await p.selectOption('#capture-size', size);
            await p.selectOption('#capture-duration', 'custom');
            await p.fill('#capture-seconds', '301');
            await p.waitForTimeout(100);
            assert(await p.locator('#create-export').isDisabled());
            await p.fill('#capture-seconds', String(seconds));
            await p.waitForFunction(() => !document.querySelector('#create-export').disabled);
            await p.click('#close-capture');
            const held = await scene(p);
            await p.click('#export-options');
            await p.waitForFunction(() => !document.querySelector('#create-export').disabled);
            if (!phone && format === 'webm')
                await p.evaluate(() => document.querySelector('#play').click());
            await p.screenshot({ path: `${out}/${label}-${format}-options.png` });
            const start = Date.now();
            await p.click('#create-export');
            console.log('Encoding', label, format, resolution, seconds);
            while (!await p.locator('#export-dialog').evaluate(e => e.open)) {
                const state = await p.evaluate(() => ({ progress: document.querySelector('#export-meter').value, active: !document.querySelector('#export-progress').hidden, message: document.querySelector('#toast').textContent }));
                if (!state.active)
                    throw Error(JSON.stringify(state));
                if (Date.now() - start > 900000)
                    throw Error('Video deadline');
                console.log(state);
                await p.waitForTimeout(15000);
            }
            console.log('Result ready');
            const ms = Date.now() - start;
            await p.waitForFunction(() => document.querySelector('#export-video').readyState >= 1);
            await p.locator('#export-video').evaluate(v => { v.currentTime = v.duration - 1; });
            await p.waitForFunction(() => !document.querySelector('#export-video').seeking);
            await p.locator('#export-video').evaluate(v => v.play());
            await p.waitForTimeout(300);
            const info = await p.locator('#export-video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, time: v.currentTime, paused: v.paused }));
            assert.equal(info.duration, seconds);
            assert(!info.paused);
            assert.equal(Math.max(info.width, info.height), resolution === 1440 ? 2560 : 1920);
            assert.equal(await storageCount(p), 1);
            const name = `${label}-${resolution}-${seconds}.${format}`, bytes = await download(p, '#export-download', name);
            await closeResult(p);
            const after = (await scene(p)).recipe;
            if (!phone && format === 'webm') {
                assert(after.simulationTime > held.recipe.simulationTime);
                await p.click('#play');
            }
            else
                assert.deepEqual(after, held.recipe);
            results.videos.push({ name, ms, bytes, ...info });
            await fs.writeFile(out + '/results.json', JSON.stringify(results, null, 2));
            console.log(results.videos.at(-1));
        }
        await p.click('#export-options');
        await p.selectOption('#capture-duration', '300');
        await p.waitForFunction(() => !document.querySelector('#create-export').disabled);
        await p.click('#create-export');
        await p.waitForTimeout(500);
        await p.click('#cancel-export');
        await p.waitForFunction(() => document.querySelector('#export-progress').hidden);
        await p.waitForTimeout(300);
        assert.equal(await storageCount(p), 0);
        assert(!await p.locator('#export-options').isDisabled());
        for (const failure of ['create', 'write']) {
            const heldFailure = await scene(p);
            await p.evaluate(f => window.failStorage = f, failure);
            await p.click('#export-options');
            await p.selectOption('#capture-format', 'mp4');
            await p.selectOption('#capture-resolution', '1080');
            await p.selectOption('#capture-duration', '30');
            await p.waitForFunction(() => !document.querySelector('#create-export').disabled);
            await p.click('#create-export');
            await p.waitForFunction(() => document.querySelector('#export-progress').hidden);
            assert(!await p.locator('#export-dialog').isVisible());
            await p.waitForTimeout(200);
            assert.equal(await storageCount(p), 0);
            assert.deepEqual((await scene(p)).recipe, heldFailure.recipe);
            await p.evaluate(() => window.failStorage = false);
        }
        await p.click('#adjust');
        await p.click('#reset-adjustments');
        await p.click('#close-adjust');
        assert.deepEqual((await scene(p)).recipe.appearance, { version: 1, brightness: 1, glow: 1, district: 1, labels: true });
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        results.checks.push({ profile: label, appearanceAndLegacy: true, titlePngGif: true, storageCleanup: true, storageFailureRecovery: true, cancellation: true, layout: true });
        await context.close();
    }
    assert.deepEqual(results.errors, []);
}
catch (e) {
    results.failure = String(e);
    if (current && !current.isClosed())
        await current.screenshot({ path: out + '/failure.png' });
    throw e;
}
finally {
    await fs.writeFile(out + '/results.json', JSON.stringify(results, null, 2));
    await browser?.close();
}
