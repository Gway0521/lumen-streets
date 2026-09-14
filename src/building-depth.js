import { random } from './city.js';
import { buildingArea, buildingCenter, commerce } from './lighting.js';
import { resolveHeight, featureSeed } from './buildings/heights.js';
import { matchLandmarks } from './buildings/catalog.js';
import { generateStructure, genericTower } from './buildings/generators.js';
import { orderedPrimitives } from './buildings/order.js';
import { LEGACY_DIRECTION, sceneProjection } from './engine/projection.js';

// Fixed art projection; no per-building compression of source measurements.
export const ROOF_DIRECTION = LEGACY_DIRECTION;
const signedArea = ring => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

export function buildingProfile(feature, activity = .5, elevation, upperPoints = feature.points, direction = ROOF_DIRECTION) {
  const area = Math.max(1, buildingArea(feature.points) - (feature.holes || []).reduce((sum, ring) => sum + buildingArea(ring), 0));
  const r = random(featureSeed(feature)), center = buildingCenter(feature.points);
  const resolved = elevation || resolveHeight(feature, area, r());
  const height = resolved.top - resolved.bottom;
  const offset = direction.map(v => v * height);
  const base = p => p.map((v, i) => v + direction[i] * resolved.bottom);
  const project = p => [p[0] + offset[0], p[1] + offset[1]];
  const roof = upperPoints.map(p => project(base(p))), holes = (feature.holes || []).map(ring => ring.map(p => project(base(p))));
  const faces = [];
  for (const [index, ring] of [feature.points, ...(feature.holes || [])].entries()) {
    const orientation = Math.sign(signedArea(ring)) * (index ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = base(ring[i]), b = base(ring[(i + 1) % ring.length]);
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const facing = orientation * (dy * offset[0] - dx * offset[1]) / length;
      if (facing >= -.01) continue;
      const upperA = index ? project(a) : roof[i], upperB = index ? project(b) : roof[(i + 1) % ring.length];
      faces.push({ a, b, length, points: [a, b, upperB, upperA], exposure: -facing / Math.hypot(...offset) });
    }
  }
  return { feature, area, center, height, elevation: resolved, offset, roof, holes, faces, direction,
    depth: center[0] * -direction[0] + center[1] * -direction[1] };
}

function outline(c, points, holes = []) {
  c.beginPath();
  for (const ring of [points, ...holes]) {
    ring.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p));
    c.closePath();
  }
}

export function prepareBuildings(city, activity, profiles, settings) {
  const {direction}=sceneProjection(settings);
  const {matches,suppressed}=matchLandmarks(city,profiles), buildings=[], rods=[];
  for(const f of city.buildings) {
    if(suppressed.has(f))continue;
    let match=matches.get(f);
    if(!match && f.role==='outline')continue;
    if(!match && (f.tags['tower:construction']==='lattice' || f.tags.man_made==='mast'))match=genericTower(f);
    if(match) {
      const generated=generateStructure(f,match.anchor,match.profile,direction);
      buildings.push(...generated.profiles);rods.push(...generated.rods);
    } else if(buildingArea(f.points)>=8)buildings.push(buildingProfile(f,activity(...buildingCenter(f.points)),undefined,f.points,direction));
  }
  buildings.sort((a,b)=>a.depth-b.depth||a.feature.id-b.feature.id);
  // Non-enumerable metadata keeps the existing array API for callers and studies.
  Object.defineProperty(buildings,'rods',{value:rods});
  Object.defineProperty(buildings,'direction',{value:direction});
  return buildings;
}

export function paintBuildingShadows(c, buildings) {
  c.save();
  const shadow=(p,z)=>[p[0]+.13*z,p[1]+.19*z];
  for (const b of buildings) {
    const top=b.elevation.top,bottom=b.elevation.bottom;
    const physical=(p,z)=>p.map((v,i)=>v-b.direction[i]*z);
    outline(c,b.roof.map(p=>shadow(physical(p,top),top)),b.holes.map(h=>h.map(p=>shadow(physical(p,top),top))));
    c.fillStyle = '#01050950'; c.fill('evenodd');
    for(const face of b.faces) {
      outline(c,face.points.map((p,i)=>{const z=i<2?bottom:top;return shadow(physical(p,z),z);}));c.fill();
    }
  }
  c.strokeStyle='#01050950';
  for(const r of buildings.rods||[]) {c.beginPath();c.moveTo(...shadow(r.a,r.a[2]));c.lineTo(...shadow(r.b,r.b[2]));c.lineWidth=r.width;c.stroke();}
  c.restore();
}

// Opaque structures occupy a separate atlas, composited after moving lights.
// Windows are painted on the visible facade plane, with dark floors between them.
function paintProfile(c, buildings, activity, glow = 1, selection) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'butt';
  for (const b of buildings) {
    const f = b.feature, a = activity(...b.center), r = random(featureSeed(f) + 931);
    const commercial = commerce(f.tags), active = Math.min(.72, .12 + a * .32 + (commercial ? .12 : 0));
    const tone = r(), windowColor = tone < .16 ? '176,208,220' : tone < .44 ? '230,224,196' : '255,207,139';
    for (const face of b.faces) {
      if(selection.kind==='roof'||selection.face!==face)continue;
      outline(c, face.points);
      const facade = c.createLinearGradient(...face.a, face.a[0] + b.offset[0], face.a[1] + b.offset[1]);
      const jade=['jade','glass','observatory'].includes(b.material);
      facade.addColorStop(0, jade ? '#142b2e' : face.exposure > .65 ? '#10191c' : '#091116');
      facade.addColorStop(1, jade ? '#244246' : face.exposure > .65 ? '#16232a' : '#0d1820');
      c.fillStyle = facade; c.fill();
      c.save(); c.clip();
      const dx = (face.b[0] - face.a[0]) / face.length, dy = (face.b[1] - face.a[1]) / face.length;
      const floors = Math.min(b.model?18:30, Math.max(1, Math.floor(b.height / 4.2)));
      const spacing = commercial ? 4.1 : 4.8;
      for (let floor = 0; floor < floors; floor++) {
        const t = (floor + .55) / floors;
        const occupancy = r() < .13 ? .03 : active;
        for (let d = 2.2; d < face.length - 1.7; d += spacing) {
          if (r() > occupancy) continue;
          const along=d/face.length,left=face.points[3],right=face.points[2];
          const x=(face.a[0]+dx*d)*(1-t)+(left[0]+(right[0]-left[0])*along)*t;
          const y=(face.a[1]+dy*d)*(1-t)+(left[1]+(right[1]-left[1])*along)*t;
          const strength = (.3 + r() * .6) * (.55 + a * .5);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx * 2.1, y + dy * 2.1);
          c.lineWidth = 3.4; c.strokeStyle = `rgba(${windowColor},${strength * .12 * glow})`; c.stroke();
          c.lineWidth = 1.05; c.strokeStyle = `rgba(${windowColor},${strength})`; c.stroke();
        }
      }
      // A few warm shopfronts anchor buildings to the street.
      if (commercial && b.elevation.bottom===0) {
        c.beginPath(); c.moveTo(face.a[0] + dx * 2, face.a[1] + dy * 2);
        c.lineTo(face.b[0] - dx * 2, face.b[1] - dy * 2);
        c.strokeStyle = `rgba(239,184,104,${.15 + a * .19})`; c.lineWidth = 1.5; c.stroke();
      }
      if(b.material==='clock') {
        // Fixed illuminated marks: wall time must never change a saved scene.
        c.strokeStyle='#edb870';c.lineWidth=1;
        for(let i=0;i<4;i++) {
          const t=.25+i*.16;
          const p=face.points[0].map((v,j)=>(v*(1-t)+face.points[1][j]*t+face.points[3][j]*(1-t)+face.points[2][j]*t)/2);
          c.strokeRect(p[0]-.5,p[1]-1.1,1,2.2);
        }
      }
      c.restore();
    }
    if(selection.kind==='face')continue;
    outline(c, b.roof, b.holes);
    c.fillStyle = b.material==='green-roof'?'#3d6960':b.material==='cornice'?'#435f5e':
      ['#14212a', '#111c24', '#19262e', '#0e1c25'][Math.floor(r() * 4)]; c.fill('evenodd');
    c.strokeStyle = '#75848b38'; c.lineWidth = .65; c.stroke();
    c.save(); c.clip('evenodd');
    const xs = b.roof.map(p => p[0]), ys = b.roof.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const shade = c.createLinearGradient(minX, minY, maxX + 1, maxY + 1);
    shade.addColorStop(0, '#8195a01a'); shade.addColorStop(1, '#02090e70');
    c.fillStyle = shade; c.fillRect(minX, minY, maxX - minX, maxY - minY);
    if (b.area > 350 && !b.model) {
      // Recessed roof deck and parapet; clipping preserves concave courtyards.
      const cx = b.center[0] + b.offset[0], cy = b.center[1] + b.offset[1];
      const inset = b.roof.map(p => [cx + (p[0] - cx) * .83, cy + (p[1] - cy) * .83]);
      outline(c, inset); c.fillStyle = '#030a1066'; c.fill();
      c.strokeStyle = '#8e9f9b28'; c.lineWidth = .75; c.stroke();
    }
    // Quiet residential roofs recede together with their district's windows.
    c.fillStyle = `rgba(2,8,13,${.22 * (1 - Math.min(1, a))})`;
    c.fillRect(minX, minY, maxX - minX, maxY - minY);
    // Roof equipment follows the dominant footprint edge, rather than north.
    let edge = [b.roof[0], b.roof[1]], longest = 0;
    for (let i = 1; i < b.roof.length; i++) {
      const length = Math.hypot(b.roof[i][0] - b.roof[i - 1][0], b.roof[i][1] - b.roof[i - 1][1]);
      if (length > longest) { longest = length; edge = [b.roof[i - 1], b.roof[i]]; }
    }
    const angle = Math.atan2(edge[1][1] - edge[0][1], edge[1][0] - edge[0][0]);
    for (let i = 0; i < (b.model?0:Math.min(24, Math.floor(b.area / 150))); i++) {
      const x = minX + 4 + r() * Math.max(1, maxX - minX - 8), y = minY + 4 + r() * Math.max(1, maxY - minY - 8);
      c.save(); c.translate(x, y); c.rotate(angle);
      const width = 2 + r() * 5, height = 2 + r() * 4;
      c.fillStyle = '#03090cb0'; c.fillRect(1, 2, width + 1, height + 1);
      c.fillStyle = '#47565e80'; c.fillRect(0, 0, width, height);
      c.fillStyle = '#99a6a32c'; c.fillRect(0, 0, width, .7);
      c.restore();
    }
    c.restore();
  }
  c.restore();
}

export function paintBuildings(c, buildings, activity, glow = 1) {
  const order=orderedPrimitives(buildings);
  for(const u of order.units) {
    if(u.kind==='rod') {
      c.save();outline(c,u.points);
      c.fillStyle=u.rod.material==='ivory'?'#b8b9a2':u.rod.material==='iron'?'#56666a':'#86513b';c.fill();
      c.strokeStyle=u.rod.material==='ivory'?'#ffe0a699':'#eead7b55';c.lineWidth=.28;c.stroke();c.restore();
    } else paintProfile(c,[u.building],activity,glow,u);
  }
  return order.stats;
}
