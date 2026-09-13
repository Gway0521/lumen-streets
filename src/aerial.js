import { random, inside, roadWidth } from './city.js';
import { districtField, streetVariation, buildingArea, buildingCenter, commerce, landmark, roadEmission } from './lighting.js';
import { streetColorField, tintStreet } from './street-colors.js';

function outline(c, points, closed = false, holes = []) {
  c.beginPath();
  for (const ring of [points,...holes]) {
    ring.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));
    if(closed)c.closePath();
  }
}
function stroke(c, points, width, color, alpha=1) {
  outline(c,points);c.lineWidth=width;c.strokeStyle=color;c.globalAlpha=alpha;c.stroke();c.globalAlpha=1;
}
function visitLine(points, spacing, visit, start=0) {
  let carry=start;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(len<.01)continue;
    for(let d=carry;d<len;d+=spacing)visit(a[0]+dx*d/len,a[1]+dy*d/len,dx/len,dy/len);
    carry=((carry-len)%spacing+spacing)%spacing;
  }
}
// All light sources are cached. The animation loop only composites this atlas.
export function renderAerial(city, appearance = { glow: 1, district: 1 }) {
  const bounds=city.bounds,w=bounds[2]-bounds[0],h=bounds[3]-bounds[1],resolution=Math.min(1.6,3600/Math.max(w,h));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*resolution);canvas.height=Math.ceil(h*resolution);
  const light=document.createElement('canvas');light.width=canvas.width;light.height=canvas.height;
  const c=canvas.getContext('2d'),l=light.getContext('2d');
  for(const ctx of [c,l]){ctx.scale(resolution,resolution);ctx.translate(-bounds[0],-bounds[1]);ctx.lineCap='round';ctx.lineJoin='round';}
  c.fillStyle='#070d13';c.fillRect(bounds[0],bounds[1],w,h);
  for(const f of city.land){outline(c,f.points,true,f.holes);c.fillStyle=f.tags.natural==='water'||f.tags.waterway?'#03080d':'#08140f';c.fill('evenodd');}
  const field=districtField(city), activity=appearance.district === 1 ? field : (x,y)=>Math.max(.03,Math.min(1.2,.45+(field(x,y)-.45)*appearance.district)),roads=city.roads.filter(f=>f.tags.tunnel!=='yes');
  for(const f of roads){const rw=roadWidth(f.tags);stroke(c,f.points,rw+2,'#1b252c',.5);stroke(c,f.points,rw,'#090e13');}
  for(const f of city.buildings) {
    const r=random(f.id),ar=buildingArea(f.points); if(ar<8)continue;
    const [bx,by]=buildingCenter(f.points),district=activity(bx,by);
    c.globalAlpha=.48+Math.min(1,district)*.52;
    outline(c,f.points,true,f.holes); c.fillStyle=['#142027','#172129','#101b23','#1b252b'][Math.floor(r()*4)];c.fill('evenodd');
    c.strokeStyle='#54616a2a';c.lineWidth=.65;c.stroke();
    if(ar>500){const [x,y]=buildingCenter(f.points);if(inside([x,y],f.points)&&!f.holes.some(h=>inside([x,y],h))){c.fillStyle='#35414a50';c.fillRect(x-4,y-3,8,6);}}
  }
  c.globalAlpha=1;
  // Continuous ribbons, with gentle world-space modulation instead of pools.
  // Matching endpoint opacity keeps the gradient continuous across OSM ways.
  const roadGain=(x,y)=>(.84+.16*Math.min(1,activity(x,y)))*(.9+.2*streetVariation(x,y));
  const colors=streetColorField(city);
  function ribbon(points,width,rgb,strength,local=false){
    l.save();l.lineCap='butt';l.lineWidth=width;l.globalAlpha=1;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
      const gradient=l.createLinearGradient(...a,...b),steps=Math.max(1,Math.ceil(len/35));
      for(let j=0;j<=steps;j++){
        const t=j/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        const tone=colors.sample(x,y),color=tintStreet(rgb,tone),district=local ? .48+.52*Math.min(1,activity(x,y)) : 1;
        gradient.addColorStop(t,`rgba(${color},${strength*roadGain(x,y)*district*(1-tone.cool*.18)})`);
      }
      l.strokeStyle=gradient;l.beginPath();l.moveTo(...a);l.lineTo(...b);l.stroke();
    }
    l.restore();
  }
  const occupied=new Map();
  function claimLamp(x,y){
    const gx=Math.floor(x/8),gy=Math.floor(y/8);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)
      if((occupied.get((gx+dx)+','+(gy+dy))||[]).some(p=>Math.hypot(p[0]-x,p[1]-y)<8))return false;
    const key=gx+','+gy;if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push([x,y]);return true;
  }
  for(const f of roads) {
    const power=roadEmission(f.tags);if(!power)continue;
    const rng=random(f.id+53),rw=roadWidth(f.tags),warm=power>=.4;
    if(warm){
      ribbon(f.points,rw+12,[223,151,57],power*.065);
      ribbon(f.points,rw*.58,[255,189,101],power*.22);
      ribbon(f.points,rw*.22,[255,204,133],power*.095);
    } else {
      // A continuous low floor for alleys and paths; explicitly unlit/tunnel ways were excluded above.
      const trace=.018+Math.sqrt(power)*.15;
      ribbon(f.points,Math.max(1,rw*.42),[239,185,107],trace,true);
      if(power>=.09)ribbon(f.points,rw+3,[222,160,79],trace*.32,true);
    }
    visitLine(f.points,warm?19:27,(x,y,dx,dy)=>{
      const active=activity(x,y),chance=warm?.86:.18+active*.5;if(rng()>chance)return;
      const tone=colors.sample(x,y),color=`rgb(${tintStreet([255,199,119],tone)})`;
      const alpha=warm?(.5+power*.35)*.46*roadGain(x,y)*(1-tone.cool*.18)*(.7+rng()*.3):Math.min(.7,(.12+active*.3)*(.3+active*.85)*(.5+streetVariation(x,y)*.65));
      for(const side of [-1,1]){
        const offset=(rng()-.5)*9,px=x+dx*offset-dy*rw*.38*side,py=y+dy*offset+dx*rw*.38*side;if(!claimLamp(px,py))continue;
        // Small staggered sources, not parallel seven-metre dashes. The ribbon carries continuity.
        const length=warm?1+rng()*1.2:1;
        l.globalAlpha=alpha;l.strokeStyle=color;l.lineWidth=warm?1.35:1;
        l.beginPath();l.moveTo(px,py);l.lineTo(px+dx*length,py+dy*length);l.stroke();
      }
    },rng()*12);
  }
  l.globalAlpha=1;
  // Small lit facades build up in dense districts. Sparse mapped land stays dark.
  for(const f of city.buildings) {
    const ar=buildingArea(f.points);if(ar<10)continue;
    const [cx,cy]=buildingCenter(f.points),a=activity(cx,cy),r=random(f.id+931),shop=commerce(f.tags),special=landmark(f.tags,ar);
    const active=Math.min(.9,.08+a*.48+(shop?.12:0)+(special?.08:0));
    const colors=['#d5e9e0','#ffce80','#efddb8','#b3d0da'];
    const color=colors[Math.floor(r()*colors.length)];
    l.strokeStyle=color;
    const rings=[f.points,...f.holes];
    for(const ring of rings)visitLine(ring,3.3,(x,y,dx,dy)=>{
      if(r()>active)return;
      l.globalAlpha=Math.min(1,(.3+r()*.65)*(.22+a*.95)*1.2);l.lineWidth=r()>.91?1.7:.9;
      l.beginPath();l.moveTo(x,y);l.lineTo(x+dx*(1.1+r()*1.3),y+dy*(1.1+r()*1.3));l.stroke();
    },r()*5);
    if(special || (shop && ar>1000 && r()>.8)) {
      const accent=['#f3b956','#79d5cf','#b3d4f0','#dd99bf'][Math.floor(r()*4)];
      outline(l,f.points,true,f.holes);l.globalAlpha=.15+Math.min(1,a)*.3;l.strokeStyle=accent;l.lineWidth=1.1;l.stroke();
      // A short accent on an existing facade, not a made-up geographic landmark.
      if(f.points.length>1)stroke(l,[f.points[0],f.points[1]],2,accent,.25+Math.min(1,a)*.5);
    }
  }
  l.globalAlpha=1;
  // Optical halation is separate from the sharp source; no per-frame blur cost.
  const bloom=document.createElement('canvas');bloom.width=Math.ceil(canvas.width/3);bloom.height=Math.ceil(canvas.height/3);
  const bc=bloom.getContext('2d');bc.drawImage(light,0,0,bloom.width,bloom.height);
  c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='screen';
  c.filter='blur(9px)';c.globalAlpha=.4*appearance.glow;c.drawImage(bloom,0,0,canvas.width,canvas.height);
  c.filter='blur(2px)';c.globalAlpha=.55*appearance.glow;c.drawImage(light,0,0);
  c.filter='none';c.globalAlpha=1;c.drawImage(light,0,0);
  c.globalCompositeOperation='source-over';
  // The finished atlas owns the composed pixels; release temporary raster backing stores now.
  light.width=light.height=bloom.width=bloom.height=0;
  return {canvas,bounds,resolution};
}
