import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingProfile, prepareBuildings } from '../src/building-depth.js';
import { terrainKind } from '../src/terrain.js';

const square = [[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]];
const feature = (patch = {}) => ({ id: 17, points: square, holes: [], tags: { building: 'yes' }, ...patch });
const canonical = faces => faces.map(f => f.points.map(p => p.join(',')).sort().join(';')).sort();

test('extrusion preserves source rings and visible faces for both winding orders', () => {
  const f = feature(), original = structuredClone(f);
  const a = buildingProfile(f), b = buildingProfile(feature({ points: square.toReversed() }));
  assert.deepEqual(canonical(a.faces), canonical(b.faces));
  assert.equal(a.faces.length, 2);
  for (let i = 0; i < square.length; i++) {
    assert.deepEqual(a.roof[i], square[i].map((v, j) => v + a.offset[j]));
  }
  assert.deepEqual(f, original);
  assert.deepEqual(buildingProfile(f), a);
});

test('courtyard walls face inward independently of ring winding and leave a roof opening', () => {
  const hole = [[15, 15], [45, 15], [45, 45], [15, 45], [15, 15]];
  const a = buildingProfile(feature({ holes: [hole] }));
  const b = buildingProfile(feature({ points: square.toReversed(), holes: [hole.toReversed()] }));
  assert.equal(a.faces.length, 4);
  assert.deepEqual(canonical(a.faces), canonical(b.faces));
  assert.equal(a.area, 2700);
  assert.deepEqual(a.holes[0][0], hole[0].map((v, i) => v + a.offset[i]));
});

test('malformed heights fall back but credible tower and hall measurements are retained', () => {
  for (const height of ['NaN', 'Infinity', '-20', '999999999', 'unknown', '0']) {
    const p = buildingProfile(feature({ tags: { building: 'yes', height } }));
    assert(Number.isFinite(p.height) && p.height > 0 && p.height <= 125);
    assert(p.roof.flat().every(Number.isFinite));
  }
  const garage = buildingProfile(feature({ tags: { building: 'garage', height: '100' } }));
  const hall = buildingProfile(feature({ tags: { building: 'warehouse', height: '100' } }));
  assert.equal(garage.height, 100); assert.equal(hall.height, 100);
  const tiny = buildingProfile(feature({ points: [[0, 0], [3, 0], [3, 3], [0, 3]], tags: { building: 'yes', height: '500' } }));
  assert.equal(tiny.height, 500);
});

test('building paint order is deterministic when source feature order changes', () => {
  const buildings = [feature({ id: 11 }), feature({ id: 9 }), feature({ id: 10, points: square.map(p => [p[0] + 100, p[1] + 100]) })];
  const a = prepareBuildings({ buildings }, () => .5), b = prepareBuildings({ buildings: buildings.toReversed() }, () => .5);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(p => p.feature.id), [9, 11, 10]);
});

test('terrain texture uses mapped water and vegetation, not arbitrary land polygons', () => {
  assert.equal(terrainKind({ natural: 'water' }), 'water');
  assert.equal(terrainKind({ leisure: 'park' }), 'green');
  assert.equal(terrainKind({ landuse: 'forest' }), 'green');
  assert.equal(terrainKind({ landuse: 'commercial' }), 'ground');
  assert.equal(terrainKind({ amenity: 'parking' }), 'ground');
});
