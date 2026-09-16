import test from 'node:test';
import assert from 'node:assert/strict';
import { FACADE, facadeType, facadeTone, hasObstructionLights } from '../src/three/facades.js';
import { vectorGeometry, snapshotGeometry } from '../src/three/geometry.js';
import { parseCity } from '../src/city.js';
import { readFile } from 'node:fs/promises';

test('mapped use overrides inferred facade families, with bounded night palettes', () => {
  for (let seed=0; seed<100; seed++) {
    assert.equal(facadeType({ building: 'hotel' }, 100, 2000, seed), FACADE.hotel);
    assert.equal(facadeType({ building: 'apartments' }, 150, 2000, seed), FACADE.paired);
    assert.equal(facadeType({ building: 'warehouse' }, 20, 4000, seed), FACADE.industrial);
    assert.equal(facadeType({ building: 'school' }, 15, 2000, seed), FACADE.masonry);
    assert.equal(facadeType({}, 120, 1000, seed, 16), FACADE.sculpted);
    assert.equal(hasObstructionLights(12, seed), false);
    assert.equal(hasObstructionLights(150, seed), true);
    for (const type of Object.values(FACADE)) {
      const tone=facadeTone(type,seed);
      assert.ok(tone.every(n => n>.06 && n<.3));
      assert.deepEqual(tone,facadeTone(type,seed));
    }
  }
});
const feature = (use, height, id=1) => ({
  id, properties: { building: use, render_height: height, render_min_height: 5 },
  geometry: { type: 'Polygon', coordinates: [[[121,25],[121.0005,25],[121.0005,25.0004],[121,25.0004],[121,25]]] },
});
test('facade identity and tone survive geometry budget fallback, including minimum elevation', () => {
  for (const use of ['apartments','office','hotel','warehouse','school']) {
    const features=[feature(use,140)];
    const detailed=vectorGeometry(features,[121,25],10000,13);
    const fallback=vectorGeometry(features,[121,25],0,13);
    assert.equal(detailed.facade.length,detailed.position.length/3*4);
    assert.equal(fallback.boxes.length,12);
    assert.equal(Math.floor(fallback.boxes[11]/10000),detailed.facade[0]);
    assert.equal(fallback.boxes[11]%10000,detailed.seed[0]);
    assert.deepEqual(fallback.boxes.slice(8,11),detailed.color.slice(0,3));
    for(let i=0;i<detailed.facade.length;i+=4) {
      assert.equal(detailed.facade[i+1],5);
      assert.equal(detailed.facade[i+2],140);
    }
    assert.deepEqual(detailed.beacons,fallback.beacons);
    assert.equal(detailed.beacons.length,8);
    assert.ok(detailed.beacons.every(Number.isFinite));
    assert.ok(Math.abs(detailed.beacons[2]-141.2)<.001);
  }
});
test('facade seeds remain stable when anonymous vector features reorder', () => {
  const a=feature('hotel',70);delete a.id;
  const b=feature('office',90);delete b.id;
  b.geometry.coordinates[0]=b.geometry.coordinates[0].map(([x,y])=>[x+.001,y]);
  const first=vectorGeometry([a,b],[121,25],0);
  const second=vectorGeometry([b,a],[121,25],0);
  assert.deepEqual(first.boxes.slice(0,12),second.boxes.slice(12,24));
});
test('landmark structure separates non-window beams from glazing and anchors warning lights to spires', async () => {
  const city=parseCity(JSON.parse(await readFile(new URL('../public/data/shanghai.json',import.meta.url))),'shanghai');
  const g=snapshotGeometry(city,700000,13);
  assert.ok(g.facade.some((v,i)=>i%4===0 && v%16===9));
  assert.ok(g.facade.some((v,i)=>i%4===0 && v%16===8));
  assert.ok(g.beacons.some((v,i)=>i%4===2 && v===633));
  assert.ok(g.facade.every(Number.isFinite));
});
