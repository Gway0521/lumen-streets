// Artistic archetypes, not a survey of real facades. Explicit use tags win;
// missing tags fall back to height, footprint and a stable per-building choice.
export const FACADE = Object.freeze({
  residential: 0, paired: 1, ribbon: 2, curtain: 3, hotel: 4,
  vertical: 5, masonry: 6, industrial: 7, sculpted: 8,
});
export function facadeRandom(seed, salt = 0) {
  let n = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}
export function facadeType(tags, height, area, seed, sides = 4) {
  const use = tags['building:use'] || tags.building || tags['building:part'];
  const r = facadeRandom(seed, 2);
  if (['warehouse', 'industrial', 'garages', 'garage', 'shed', 'roof', 'greenhouse', 'stadium'].includes(use)) return FACADE.industrial;
  if (use === 'hotel' || tags.tourism === 'hotel') return FACADE.hotel;
  if (['church', 'cathedral', 'civic', 'public', 'school', 'university'].includes(use) || tags['building:material'] === 'brick') return FACADE.masonry;
  if (['apartments', 'residential', 'house', 'detached', 'terrace', 'dormitory'].includes(use)) return height > 20 || r > .5 ? FACADE.paired : FACADE.residential;
  if (use === 'office' || tags.office || use === 'commercial') return height > 85 ? (r < .5 ? FACADE.vertical : FACADE.curtain) : (r < .6 ? FACADE.ribbon : FACADE.curtain);
  if (height > 100 && sides >= 8) return FACADE.sculpted;
  if (height > 95) return r < .4 ? FACADE.vertical : r < .8 ? FACADE.curtain : FACADE.hotel;
  if (height < 12 && area > 1600) return FACADE.industrial;
  if (height < 14) return r < .55 ? FACADE.residential : r < .8 ? FACADE.masonry : FACADE.paired;
  return [FACADE.paired, FACADE.ribbon, FACADE.hotel, FACADE.curtain, FACADE.masonry][Math.floor(r * 5)];
}
// Night-adapted concrete, limestone, bronze, charcoal, blue and green glass.
const tones = [
  [.205, .213, .22], [.24, .218, .18], [.155, .145, .135],
  [.095, .135, .16], [.105, .158, .151], [.13, .145, .165],
  [.205, .185, .172], [.15, .174, .19],
];
export function facadeTone(type, seed) {
  const choices = type === 3 || type === 5 || type === 8 ? [3, 4, 5, 7]
    : type === 6 ? [1, 2, 6] : type === 7 ? [0, 2, 5] : [0, 1, 2, 5, 6, 7];
  const tone = tones[choices[Math.floor(facadeRandom(seed, 6) * choices.length)]];
  const value = .88 + facadeRandom(seed, 7) * .24;
  return tone.map(n => n * value);
}
export function hasObstructionLights(height, seed) {
  // Visual heuristic only: local aviation requirements depend on location.
  return height >= 120 || (height >= 58 && facadeRandom(seed, 9) > .68);
}
