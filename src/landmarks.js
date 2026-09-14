import { buildingArea, buildingCenter } from './lighting.js';
import { worldToScreen } from './engine/projection.js';

const cache = new WeakMap();
const nameOf = tags => tags.name || tags['name:en'] || tags['name:zh-Hant'] || tags['name:zh'] || '';
const normalName = text => text.normalize('NFKC').toLowerCase().replace(/[\s·・–-]+/g, '');

/** Ranked, mapped places shared by labels and the restrained landmark lighting accents. */
export function selectLandmarks(city) {
  if (cache.has(city)) return cache.get(city);
  const preferred = new Set(city.labels || []), candidates = [];
  const add = (feature, point, area, station = false) => {
    const tags = feature.tags, name = nameOf(tags);
    if (!name || !point.every(Number.isFinite)) return;
    const [x,y] = point, [left,top,right,bottom] = city.bounds;
    if (x < left || x > right || y < top || y > bottom) return;
    const height = Number.parseFloat(tags.height) || (Number.parseFloat(tags['building:levels']) || 0)*3;
    const green = ['park','garden','nature_reserve'].includes(tags.leisure) || ['forest','grass','meadow'].includes(tags.landuse) || ['wood','water'].includes(tags.natural);
    const cultural = !green && (['museum','gallery','attraction','viewpoint'].includes(tags.tourism) || !!tags.historic);
    const culturalScore = ['museum','gallery'].includes(tags.tourism) ? 90 : tags.tourism ? 85 : ['yes','building'].includes(tags.historic) ? 60 : 80;
    const stationScore = tags.station === 'subway' || tags.subway === 'yes' ? 78 : 95;
    let score = preferred.has(name) ? 120 : cultural ? culturalScore : station || tags.building === 'train_station' ? stationScore :
      height >= 90 ? 72 : ['university','college','library','theatre','townhall','arts_centre'].includes(tags.amenity) ? 65 :
      green && area > 1500 ? 55 : tags.building && area > 1800 ? 25 : 0;
    if (!score) return;
    score += Math.min(12, Math.log1p(area)/1.2) + Math.min(15,height/25) + (tags.wikidata || tags.wikipedia ? 10 : 0);
    candidates.push({ sourceId: feature.sourceId || `${station?'station':'way'}/${feature.id}`, tags, name, point, area, score,
      accent: !tags.highway && !green &&
        (cultural || station || tags.building === 'train_station' || height >= 90 || preferred.has(name)) });
  };
  for (const f of city.features || []) if (f.points?.length) add(f,buildingCenter(f.points),f.points.length > 3 ? buildingArea(f.points) : 0);
  for (const s of city.rail?.stations || []) if (['station','halt'].includes(s.tags.railway)) add(s,s.point,0,true);
  candidates.sort((a,b)=>b.score-a.score || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const selected = [];
  for (const p of candidates) {
    const names = new Set([p.name,p.tags['name:en'],p.tags['name:zh-Hant'],p.tags['name:zh']].filter(Boolean).map(normalName));
    if (selected.some(q=>[q.name,q.tags['name:en'],q.tags['name:zh-Hant'],q.tags['name:zh']].filter(Boolean).some(n=>names.has(normalName(n))) ||
        Math.hypot(q.point[0]-p.point[0],q.point[1]-p.point[1]) < 100)) continue;
    selected.push(p); if (selected.length === 32) break;
  }
  const result = Object.freeze(selected.map(p=>Object.freeze({...p,point:Object.freeze([...p.point])})));
  cache.set(city,result); return result;
}

export function landmarkName(place, locale) {
  const t = place.tags;
  return (locale === 'en' ? t['name:en'] || place.name : t['name:zh-Hant'] || t['name:zh'] || place.name).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120);
}

/** Measured screen rectangles, rather than point distance, avoid long-name collisions. */
export function layoutLandmarkLabels(city, camera, view, measure) {
  const {width,height,quietMode=false,locale='en'} = view;
  const origin = view.origin || [width*(width>760&&!quietMode ? .63 : .5),height*.5];
  const left = width>760&&!quietMode?330:24, right=width-24, top=quietMode?24:90;
  const bottom=height-(quietMode ? 24 : width<=760 ? Math.min(300,height*.4) : 80);
  const placed = [], limit = width < 600 ? 5 : 9;
  for(const place of selectLandmarks(city)) {
    const point=view.landmarkAnchors?.[place.sourceId]||place.point;
    const [x,y]=worldToScreen(point,camera,origin,view.projection);
    let text=landmarkName(place,locale);const maxWidth=Math.min(220,right-left);
    if(measure(text)>maxWidth){const chars=[...text];while(chars.length&&measure(chars.join('')+'…')>maxWidth)chars.pop();text=chars.join('')+'…';}
    const half=measure(text)/2+7, rect=[x-half,y-13,x+half,y+13];
    if(rect[0]<left||rect[2]>right||rect[1]<top||rect[3]>bottom || placed.some(p=>rect[0]<p.rect[2]+14&&rect[2]>p.rect[0]-14&&rect[1]<p.rect[3]+14&&rect[3]>p.rect[1]-14))continue;
    placed.push({text,x,y,rect,sourceId:place.sourceId});if(placed.length===limit)break;
  }
  return placed;
}
