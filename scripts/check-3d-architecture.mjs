import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = process.env.QA_OUTPUT || 'artifacts/3d-architecture';
const base = process.env.QA_URL || 'http://127.0.0.1:5183/';
const production = !base.includes(':5183');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1664, height: 936 } });
const report = { errors: [], views: [] };
page.on('pageerror', e => report.errors.push(e.stack));
page.on('console', e => { if (e.type() === 'error') report.errors.push(e.text()); });
async function ready() {
  await page.waitForTimeout(700);
  if (production) {
    await page.waitForFunction(() => /Aerial Gold|航拍金夜/.test(document.querySelector('#status')?.textContent || '') && /[1-9]\d+ buildings/.test(document.querySelector('#coordinates')?.textContent || ''), null, { timeout: 90000 });
    await page.waitForTimeout(400);
    return;
  }
  await page.waitForFunction(() => {
    const app = window.__lumen3d;
    if (!app?.stream?.ready || app.stream.busy) return false;
    const b = app.map.getBounds(), key = app.stream.lastKey.split(':');
    return key[1] === [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(n => n.toFixed(3)).join(',') && Number(key[2]) === Math.floor(app.map.getZoom()*4);
  }, null, { timeout: 90000 });
  await page.evaluate(() => { window.__lumen3d.layer.playing = false; window.__lumen3d.layer.time = 1; window.__lumen3d.map.triggerRepaint(); });
  await page.waitForTimeout(150);
}
try {
  for (const [name, query] of [
    ['sapporo-near', 'city=sapporo&lng=141.3566&lat=43.0591&zoom=16.5&bearing=0&pitch=40'],
    ['shanghai-skyline', 'city=shanghai&lng=121.500&lat=31.240&zoom=15.5&bearing=-24&pitch=50'],
    ['taipei', 'city=xinyi&lng=121.564&lat=25.037&zoom=15.8&bearing=24&pitch=45'],
    ['london-global', 'lng=-.019&lat=51.504&zoom=15.7&bearing=-20&pitch=50'],
  ]) {
    await page.goto(`${base}three.html?${query}&embed=1&lang=zh-TW${production ? '&debug=1' : ''}`);
    await ready();
    await page.screenshot({ path: `${out}/${name}.png` });
    const state = await page.evaluate(() => {
      if (!window.__lumen3d) return {
        hud: document.querySelector('#coordinates').textContent,
        glError: document.querySelector('.maplibregl-canvas').getContext('webgl2').getError(),
      };
      const { layer } = window.__lumen3d;
      const families = {}, data = layer.mesh.geometry.attributes.facade.array;
      for (let i=0; i<data.length; i+=4) families[data[i]] = (families[data[i]] || 0) + 1;
      return { stats: layer.stats, families, glError: layer.renderer.getContext().getError(), resources: { ...layer.renderer.info.memory } };
    });
    assert.equal(state.glError, 0);
    if (!production) {
      assert.ok(Object.keys(state.families).length >= 4);
      assert.ok(state.stats.beacons > 0 && state.stats.beacons <= 4096);
    }
    report.views.push({ name, ...state });
  }
  // The atlas uses the production geometry and shader, without the map or bloom.
  // It makes window proportions and material/lighting relationships reviewable.
  if (!production) {
    await page.setViewportSize({ width: 1536, height: 1260 });
    report.gpu = await page.evaluate(async () => {
      const { map, stream } = window.__lumen3d;
      stream.dispose(); map.remove();
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { MeshBuilder } = await import('/src/three/geometry.js');
      const { nightMaterial, beaconMaterial } = await import('/src/three/materials.js');
      const { facadeTone } = await import('/src/three/facades.js');
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#080e15;color:#ddd;display:grid;grid-template-columns:repeat(3,1fr);font:16px system-ui;overflow:auto';
      const titles = ['01 / 住宅 · 獨立窗', '02 / 集合住宅 · 成對錯層窗', '03 / 辦公樓 · 水平帶窗', '04 / 玻璃帷幕 · 成組辦公室', '05 / 飯店 · 細長客房窗', '06 / 高塔 · 垂直肋柱', '07 / 石材 · 高窄拱窗', '08 / 工業 · 高側窗', '09 / 造型塔樓 · 錯列與流線'];
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(512, 374);
      renderer.setClearColor('#080e15');
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      const gl = renderer.getContext(), pixels = new Uint8Array(512*374*4), families = [];
      for (let type=0; type<9; type++) {
        const scene = new THREE.Scene(), material = nightMaterial(), builder = new MeshBuilder();
        const seed = [191, 277, 1681, 891, 137, 4093, 941, 617, 8191][type];
        const height = type === 7 ? 24 : 64;
        builder.appearance = { type, bottom: 0, top: height, tone: facadeTone(type, seed) };
        builder.solid([[[-27,-12],[27,-12],[27,12],[-27,12]]],0,height,seed);
        const data = builder.finish(), geometry = new THREE.BufferGeometry();
        for (const [key,size] of Object.entries({position:3,normal:3,uv:2,color:3,seed:1,facade:4})) geometry.setAttribute(key,new THREE.BufferAttribute(data[key],size));
        scene.add(new THREE.Mesh(geometry,material));
        const camera = new THREE.PerspectiveCamera(36,512/374,1,1000);
        camera.up.set(0,0,1);camera.position.set(70,-153,84);camera.lookAt(0,0,32);
        renderer.render(scene,camera);
        gl.readPixels(0,0,512,374,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let signature=2166136261, lit=0;
        for(let i=0;i<pixels.length;i+=4) {
          signature=Math.imul(signature^pixels[i],16777619);
          if(pixels[i]>100)lit++;
        }
        families.push({type,signature:signature>>>0,lit});
        const figure = document.createElement('figure'); figure.style.cssText='margin:0;height:420px;border-bottom:1px solid #22303c';
        const img = document.createElement('img');img.src=renderer.domElement.toDataURL();img.style.width='100%';
        const label = document.createElement('figcaption');label.textContent=titles[type];label.style.cssText='padding:0 28px;color:#bac6d3;letter-spacing:1px';
        figure.append(img,label);document.body.append(figure);
        geometry.dispose();material.dispose();
      }
      const beacon = beaconMaterial(), geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
      geometry.setAttribute('phase',new THREE.Float32BufferAttribute([.6],1));
      beacon.uniforms.pointSize.value=12;
      renderer.setClearColor(0,0);
      const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(45,512/374,1,100);
      camera.position.z=10;scene.add(new THREE.Points(geometry,beacon));
      const sample = (time,glow=1) => {
        beacon.uniforms.time.value=time;beacon.uniforms.glow.value=glow;
        renderer.render(scene,camera);gl.readPixels(0,0,512,374,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const sum=[0,0,0];
        for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)sum[c]+=pixels[i+c];
        return sum;
      };
      const warning={bright:sample(.8),dim:sample(1.8),repeat:sample(.8),off:sample(.8,0)};
      const glError=gl.getError();
      geometry.dispose();beacon.dispose();
      renderer.dispose();renderer.forceContextLoss();
      return {families,warning,glError};
    });
    assert.equal(report.gpu.glError,0);
    assert.equal(new Set(report.gpu.families.map(f=>f.signature)).size,9);
    assert.ok(report.gpu.families.every(f=>f.lit>10));
    const warning=report.gpu.warning;
    assert.ok(warning.bright[0]>warning.dim[0]*3);
    assert.ok(warning.bright[0]>warning.bright[1]*10);
    assert.deepEqual(warning.bright,warning.repeat);
    assert.deepEqual(warning.off,[0,0,0]);
    await page.screenshot({ path: `${out}/facade-atlas.png` });
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/architecture-report.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
}
