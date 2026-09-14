import { inside } from '../city.js';
import { projectVertex } from './generators.js';
import { trianglePrimitive } from './components.js';

const bounds = points => points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];

function heightPlane(points, bottom, top) {
  const a=points[0],u=sub(points[1],a),v=sub(points[3],a),det=cross(u,v);
  return Math.abs(det)<1e-7 ? ()=>top : p=>bottom+cross(u,sub(p,a))/det*(top-bottom);
}

function rodPrimitive(rod, direction) {
  const a=projectVertex(rod.a,direction),b=projectVertex(rod.b,direction),d=sub(b,a),length=Math.hypot(...d)||1;
  const n=[-d[1]/length*rod.width/2,d[0]/length*rod.width/2];
  const points=[[a[0]+n[0],a[1]+n[1]],[a[0]-n[0],a[1]-n[1]],[b[0]-n[0],b[1]-n[1]],[b[0]+n[0],b[1]+n[1]]];
  return {kind:'rod',rod,points,holes:[],height:p=>rod.a[2]+((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/(length*length)*(rod.b[2]-rod.a[2])};
}

function overlaps(a,b) {
  const inShape=(p,s)=>inside(p,s.points)&&!s.holes.some(h=>inside(p,h));
  const points=[];
  for(const p of a.points)if(inShape(p,b))points.push(p);
  for(const p of b.points)if(inShape(p,a))points.push(p);
  // Polygon edges supply exact overlap witnesses for crossing thin facades/rods.
  for(let i=0;i<a.points.length;i++) {
    const p=a.points[i],d=sub(a.points[(i+1)%a.points.length],p);
    for(let j=0;j<b.points.length;j++) {
      const q=b.points[j],e=sub(b.points[(j+1)%b.points.length],q),det=cross(d,e);
      if(Math.abs(det)<1e-8)continue;
      const delta=sub(q,p),t=cross(delta,e)/det,u=cross(delta,d)/det;
      if(t>0&&t<1&&u>0&&u<1) {
        const v=[p[0]+t*d[0],p[1]+t*d[1]];
        if(!a.holes.some(h=>inside(v,h))&&!b.holes.some(h=>inside(v,h)))points.push(v);
      }
    }
  }
  // Coincident polygons have no strict edge crossings.
  const center=[(Math.max(a.bounds[0],b.bounds[0])+Math.min(a.bounds[2],b.bounds[2]))/2,
    (Math.max(a.bounds[1],b.bounds[1])+Math.min(a.bounds[3],b.bounds[3]))/2];
  if(inShape(center,a)&&inShape(center,b))points.push(center);
  let front=false,back=false;
  for(const p of points) {const delta=a.height(p)-b.height(p);if(delta>.05)front=true;if(delta<-.05)back=true;}
  return front===back ? 0 : front ? 1 : -1;
}

/** Static face/rod ordering, comparing elevation where projected silhouettes overlap.
 * A bounded spatial index avoids all-pairs work. Interpenetration/cycles keep a stable
 * painter fallback; this is not a general-purpose depth buffer for arbitrary meshes. */
export function orderedPrimitives(buildings) {
  const units=[];
  for(const b of buildings) {
    for(const face of b.faces)units.push({kind:'face',building:b,face,points:face.points,holes:[],height:heightPlane(face.points,b.elevation.bottom,b.elevation.top)});
    units.push({kind:'roof',building:b,points:b.roof,holes:b.holes,height:()=>b.elevation.top});
  }
  for(const rod of buildings.rods||[])units.push(rodPrimitive(rod,buildings.direction));
  for(const t of buildings.triangles||[]) {const u=trianglePrimitive(t,buildings.direction);if(u)units.push(u);}
  const direction=buildings.direction||[-.32,-.48],factor=1+direction[0]**2+direction[1]**2;
  for(const [i,u]of units.entries()) {
    u.bounds=bounds(u.points);u.index=i;
    const center=[(u.bounds[0]+u.bounds[2])/2,(u.bounds[1]+u.bounds[3])/2];
    u.depth=-direction[0]*center[0]-direction[1]*center[1]+factor*u.height(center);
  }
  units.sort((a,b)=>a.depth-b.depth||a.index-b.index);
  // Curved landmarks concentrate many small triangles; smaller cells prevent their
  // local density from exhausting the generic-footprint index's per-cell budget.
  const cellSize=buildings.triangles?.length?32:96;
  const grid=new Map(),edges=units.map(()=>[]),indegree=new Uint32Array(units.length);
  let comparisons=0,ambiguous=0;
  for(let i=0;i<units.length;i++) {
    const a=units[i],box=a.bounds,seen=new Set();
    if((Math.ceil((box[2]-box[0])/cellSize)+1)*(Math.ceil((box[3]-box[1])/cellSize)+1)>4096){ambiguous++;continue;}
    for(let x=Math.floor(box[0]/cellSize);x<=Math.floor(box[2]/cellSize);x++)for(let y=Math.floor(box[1]/cellSize);y<=Math.floor(box[3]/cellSize);y++) {
      const key=`${x},${y}`;
      if(!grid.has(key))grid.set(key,[]);
      const cell=grid.get(key);
      for(const j of cell) {
        if(seen.has(j))continue;seen.add(j);
        const b=units[j],bb=b.bounds;
        if(Math.min(box[2],bb[2])-Math.max(box[0],bb[0])<.05 || Math.min(box[3],bb[3])-Math.max(box[1],bb[1])<.05)continue;
        if(++comparisons>600000 || a.points.length*b.points.length>20000) {ambiguous++;continue;}
        const order=overlaps(a,b);
        if(order>0){edges[j].push(i);indegree[i]++;}
        else if(order<0){edges[i].push(j);indegree[j]++;}
      }
      if(cell.length<512)cell.push(i);else ambiguous++;
    }
  }
  // Priority heap preserves stable depth order among unrelated faces.
  const heap=[],push=value=>{heap.push(value);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p]<=value)break;heap[i]=heap[p];i=p;}heap[i]=value;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1]<heap[j])j++;if(heap[j]>=last)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
  for(let i=0;i<units.length;i++)if(!indegree[i])push(i);
  const ordered=[],done=new Uint8Array(units.length);let cycles=0,cursor=0;
  while(ordered.length<units.length) {
    if(!heap.length){while(done[cursor])cursor++;push(cursor);cycles++;}
    const i=pop();if(done[i])continue;done[i]=1;ordered.push(units[i]);
    for(const j of edges[i])if(!done[j]&&indegree[j]&&!--indegree[j])push(j);
  }
  return {units:ordered,stats:{primitives:units.length,comparisons,cycles,ambiguous}};
}

export function visualBounds(buildings, groundBounds) {
  const b=[...groundBounds];
  const add=p=>{b[0]=Math.min(b[0],p[0]-3);b[1]=Math.min(b[1],p[1]-3);b[2]=Math.max(b[2],p[0]+3);b[3]=Math.max(b[3],p[1]+3);};
  for(const f of buildings){f.roof.forEach(add);for(const face of f.faces)face.points.forEach(add);}
  for(const r of buildings.rods||[]){add(projectVertex(r.a,buildings.direction));add(projectVertex(r.b,buildings.direction));}
  for(const t of buildings.triangles||[])t.vertices.forEach(p=>add(projectVertex(p,buildings.direction)));
  return b;
}
