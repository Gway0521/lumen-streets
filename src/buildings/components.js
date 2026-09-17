import { projectVertex } from './generators.js';
import { featureSeed } from './heights.js';
import { random } from "../shared/random.js";
import earcut from 'earcut';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};

/** Declarative, bounded solids in metres. Each triangle retains its physical vertices
 * for camera depth and ground shadows; caps and openings are actual geometry. */
export function generateComponents(feature, anchor, profile) {
  const triangles=[],angle=profile.art.rotation*Math.PI/180;
  const world=([x,y,z])=>[anchor[0]+x*Math.cos(angle)-y*Math.sin(angle),anchor[1]+x*Math.sin(angle)+y*Math.cos(angle),z];
  const add=(a,b,c,component,windows=false)=>{
    const vertices=[a,b,c].map(world),normal=unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
    if(Math.hypot(...cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])))<1e-6)return;
    triangles.push({vertices,normal,material:component.material,windows,seed:featureSeed(feature)+triangles.length*17,sourceId:feature.sourceId});
  };
  const loft=(rings,component)=>{
    for(let j=1;j<rings.length;j++)for(let i=0;i<rings[j].length;i++) {
      const n=(i+1)%rings[j].length,a=rings[j-1][i],b=rings[j-1][n],c=rings[j][n],d=rings[j][i];
      add(a,b,c,component,component.windows);add(a,c,d,component,component.windows);
    }
    for(const [ring,top]of [[rings[0],false],[rings.at(-1),true]]) {
      if (component.shape === 'polygon') {
        const indices=earcut(ring.flatMap(p=>p.slice(0,2)));
        for(let i=0;i<indices.length;i+=3) {
          const [a,b,c]=indices.slice(i,i+3).map(j=>ring[j]);
          add(a,top?b:c,top?c:b,component);
        }
        continue;
      }
      const center=ring[0].map((_,i)=>ring.reduce((s,p)=>s+p[i],0)/ring.length);
      for(let i=0;i<ring.length;i++)add(center,ring[top?i:(i+1)%ring.length],ring[top?(i+1)%ring.length:i],component);
    }
  };
  for(const component of profile.components) {
    if(component.kind==='loft') {
      const rings=component.sections.map(([z,width,depth,rotation,x,y])=>{
        const a=rotation*Math.PI/180;
        const coords=component.shape==='polygon'?component.outline:component.shape==='rectangle'?[[-1,-1],[1,-1],[1,1],[-1,1]]:
          Array.from({length:24},(_,i)=>{const t=i*Math.PI/12,r=component.shape==='rounded-triangle'?1+.13*Math.cos(3*t):1;return [r*Math.cos(t),r*Math.sin(t)];});
        return coords.map(([u,v])=>{const px=u*width/2,py=v*depth/2;return [x+px*Math.cos(a)-py*Math.sin(a),y+px*Math.sin(a)+py*Math.cos(a),z];});
      });
      loft(rings,component);
    } else if(component.kind==='ellipsoid') {
      const rings=Array.from({length:13},(_,j)=>Array.from({length:24},(_,i)=>{
        const latitude=-Math.PI/2+j*Math.PI/12,t=i*Math.PI/12;
        return [component.center[0]+component.radii[0]*Math.cos(latitude)*Math.cos(t),
          component.center[1]+component.radii[1]*Math.cos(latitude)*Math.sin(t),component.center[2]+component.radii[2]*Math.sin(latitude)];
      }));
      loft(rings,component);
    } else {
      const axis=unit(sub(component.b,component.a));
      const u=unit(cross(axis,Math.abs(axis[2])<.9?[0,0,1]:[0,1,0])),v=cross(axis,u);
      loft([component.a,component.b].map(center=>Array.from({length:8},(_,i)=>{
        const t=i*Math.PI/4;return center.map((n,k)=>n+component.radius*(u[k]*Math.cos(t)+v[k]*Math.sin(t)));
      })),component);
    }
  }
  return triangles;
}

export function trianglePrimitive(triangle, direction) {
  const toward=[-direction[0],-direction[1],1];
  if(triangle.normal.reduce((s,n,i)=>s+n*toward[i],0)<=1e-8)return null;
  const points=triangle.vertices.map(p=>projectVertex(p,direction)),[a,b,c]=points;
  const det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(det)<1e-7)return null;
  const height=p=>{
    const u=((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/det;
    const v=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/det;
    return triangle.vertices[0][2]*(1-u-v)+triangle.vertices[1][2]*u+triangle.vertices[2][2]*v;
  };
  return {kind:'triangle',triangle,points,holes:[],height};
}

const materials={glass:[20,38,46],silver:[45,51,52],stone:[34,37,36],rose:[85,44,61],ivory:[106,105,85],steel:[77,47,35]};
export function paintTriangle(c,u,glow) {
  const t=u.triangle,r=random(t.seed),color=materials[t.material];
  const exposure=.6+.45*Math.max(0,t.normal[0]*-.3+t.normal[1]*-.45+t.normal[2]*.84)+.08*(t.normal[0]+1);
  c.save();c.beginPath();u.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();
  c.fillStyle=`rgb(${color.map(v=>Math.round(v*exposure))})`;c.fill();
  // A hairline of the same material closes antialiased triangle seams without lighting the mesh edges.
  c.strokeStyle=c.fillStyle;c.lineWidth=.18;c.stroke();
  if(t.windows) {
    c.clip();
    const [a,b,d]=u.points,vertices=t.vertices;
    const minimum=t.material==='rose'?3:1;
    const rows=Math.max(minimum,Math.min(80,Math.ceil(Math.hypot(...sub(vertices[2],vertices[0]))/5)));
    const columns=Math.max(minimum,Math.min(36,Math.ceil(Math.hypot(...sub(vertices[1],vertices[0]))/4)));
    for(let j=1;j<rows;j++)for(let i=1;i<columns;i++) {
      const x=i/columns,y=j/rows;if(x+y>=.98||r()>.36)continue;
      const px=a[0]*(1-x-y)+b[0]*x+d[0]*y,py=a[1]*(1-x-y)+b[1]*x+d[1]*y;
      c.fillStyle=r()<.23?`rgba(166,208,220,${.45*glow})`:`rgba(236,208,159,${(.22+r()*.48)*glow})`;
      c.fillRect(px-.6,py-.4,1.2,.8);
    }
  }
  c.restore();
}
