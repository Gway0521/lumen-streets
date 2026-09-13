import { readFileSync } from 'node:fs';
import { regions } from '../src/city.js';
import { createSceneData } from '../src/scene/data.ts';
import { createRecipe, validateRecipe } from '../src/scene/recipe.ts';
import { buildGraph, Traffic } from '../src/traffic.js';

const rows = [];
for (const [id, region] of Object.entries(regions)) {
  const path = new URL('../public/data/' + id + '.json', import.meta.url);
  const text = readFileSync(path, 'utf8');
  const raw = JSON.parse(text);
  if (!raw.pocketPlaces?.relationsRetrievedAt) throw new Error(id + ': relation snapshot missing');
  const rail = readFileSync(new URL('../public/data/' + id + '-rail.json', import.meta.url), 'utf8');
  const data = await createSceneData(id, text, rail);
  validateRecipe(createRecipe(data), data);
  const city = data.geometry;
  const graph = buildGraph(city);
  const sim = new Traffic(graph, 29);
  sim.setCount(880);
  for (let i = 0; i < 1200; i++) sim.update(0.05);
  if (sim.cars.length !== 880 || sim.cars.some(c => !Number.isFinite(c.s) || !Number.isFinite(c.speed) || c.s < 0)) {
    throw new Error(id + ': invalid traffic after 60 simulated seconds');
  }
  const row = {
    id, name: region.name, english: region.english, description: region.description,
    schemaVersion: data.schemaVersion, fingerprint: data.fingerprint,
    bbox: city.source.bbox,
    widthKm: +( (city.bounds[2] - city.bounds[0]) / 1000).toFixed(2),
    heightKm: +( (city.bounds[3] - city.bounds[1]) / 1000).toFixed(2),
    buildings: city.buildings.length, roadWays: city.roads.length,
    landShapes: city.land.length,
    waterShapes: city.land.filter(f => f.tags.natural === 'water' || f.tags.waterway).length,
    buildingHoles: city.buildings.reduce((n,f) => n + f.holes.length,0),
    edges: graph.edges.length, simulatedSignals: graph.signals.length,
    bytes: Buffer.byteLength(text), retrievedAt: city.source.retrievedAt,
    relationsRetrievedAt: city.source.relationsRetrievedAt,
    trafficCheck: '880 cars / 60 simulated seconds / finite state',
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(`Validated ${rows.length} preset scenes.`);
