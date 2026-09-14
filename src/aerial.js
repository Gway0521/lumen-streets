import { random, roadWidth } from './city.js';
import { districtField, streetVariation, roadEmission } from './lighting.js';
import { streetColorField, tintStreet } from './street-colors.js';
import { prepareBuildings, paintBuildings, paintBuildingShadows } from './building-depth.js';
import { paintTerrain, paintReflections } from './terrain.js';

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
  // Paint these static surfaces in software, then copy the finished atlas.
  // Queuing the detailed lights on the GPU can break rendering on Android/Adreno.
  const c=canvas.getContext('2d',{willReadFrequently:true}),l=light.getContext('2d',{willReadFrequently:true});
  for(const ctx of [c,l]){ctx.scale(resolution,resolution);ctx.translate(-bounds[0],-bounds[1]);ctx.lineCap='round';ctx.lineJoin='round';}
  c.fillStyle='#091219';c.fillRect(bounds[0],bounds[1],w,h);
  paintTerrain(c,city);
  const field=districtField(city), activity=appearance.district === 1 ? field : (x,y)=>Math.max(.03,Math.min(1.2,.45+(field(x,y)-.45)*appearance.district)),roads=city.roads.filter(f=>f.tags.tunnel!=='yes');
  for(const f of roads){const rw=roadWidth(f.tags);stroke(c,f.points,rw+2,'#303536',.55);stroke(c,f.points,rw,'#10171c');}
  const buildings=prepareBuildings(city,activity);
  paintBuildingShadows(c,buildings);
  c.globalAlpha=1;
  // Continuous ribbons, with gentle world-space modulation instead of pools.
  // Matching endpoint opacity keeps the gradient continuous across OSM ways.
  const roadGain=(x,y)=>(.84+.16*Math.min(1,activity(x,y)))*(.9+.2*streetVariation(x,y));
  const colors=streetColorField(city);
  function ribbon(points,width,rgb,strength,local=false,offset=0){
    l.save();l.lineCap='butt';l.lineWidth=width;l.globalAlpha=1;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
      const gradient=l.createLinearGradient(...a,...b),steps=Math.max(1,Math.ceil(len/35));
      for(let j=0;j<=steps;j++){
        const t=j/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        const tone=colors.sample(x,y),color=tintStreet(rgb,tone),district=local ? .48+.52*Math.min(1,activity(x,y)) : 1;
        gradient.addColorStop(t,`rgba(${color},${strength*roadGain(x,y)*district*(1-tone.cool*.18)})`);
      }
      const nx=-(b[1]-a[1])/len*offset,ny=(b[0]-a[0])/len*offset;
      l.strokeStyle=gradient;l.beginPath();l.moveTo(a[0]+nx,a[1]+ny);l.lineTo(b[0]+nx,b[1]+ny);l.stroke();
    }
    l.restore();
  }
  const occupied=new Map(),lamps=[];
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
      ribbon(f.points,rw+17,[223,151,67],power*.05);
      ribbon(f.points,rw*.88,[233,171,91],power*.11);
      // The asphalt stays visible between two thin, continuous shoulders.
      for(const side of [-1,1]){
        ribbon(f.points,rw*.21,[255,184,101],power*.24,false,rw*.34*side);
        ribbon(f.points,.9,[255,209,145],power*.22,false,rw*.4*side);
      }
      c.save();c.setLineDash([2.5,9]);stroke(c,f.points,.55,'#c6af8180',power*.28);c.restore();
    } else {
      // A continuous low floor for alleys and paths; explicitly unlit/tunnel ways were excluded above.
      const trace=.018+Math.sqrt(power)*.15;
      ribbon(f.points,Math.max(1,rw*.42),[239,185,107],trace,true);
      if(power>=.09)ribbon(f.points,rw+3,[222,160,79],trace*.32,true);
    }
    visitLine(f.points,warm?19:27,(x,y,dx,dy)=>{
      const active=activity(x,y),chance=warm?.86:.18+active*.5;if(rng()>chance)return;
      const tone=colors.sample(x,y),color=`rgb(${tintStreet([255,199,119],tone)})`;
      const alpha=warm?(.5+power*.35)*.7*roadGain(x,y)*(1-tone.cool*.18)*(.7+rng()*.3):Math.min(.7,(.18+active*.3)*(.4+active*.85)*(.5+streetVariation(x,y)*.65));
      for(const side of [-1,1]){
        const offset=(rng()-.5)*9,px=x+dx*offset-dy*rw*.38*side,py=y+dy*offset+dx*rw*.38*side;if(!claimLamp(px,py))continue;
        // Small staggered sources, not parallel seven-metre dashes. The ribbon carries continuity.
        const length=warm?1+rng()*1.2:1;
        lamps.push({x:px,y:py,alpha});
        if(warm){
          const halo=l.createRadialGradient(px,py,0,px,py,8);
          halo.addColorStop(0,`rgba(255,193,111,${alpha*.32})`);halo.addColorStop(1,'#e5a35800');
          l.globalAlpha=1;l.fillStyle=halo;l.fillRect(px-8,py-8,16,16);
        }
        l.globalAlpha=alpha;l.strokeStyle=color;l.lineWidth=warm?1.35:1;
        l.beginPath();l.moveTo(px,py);l.lineTo(px+dx*length,py+dy*length);l.stroke();
      }
    },rng()*12);
  }
  l.globalAlpha=1;
  paintReflections(c,city,lamps);
  l.globalAlpha=1;
  // Optical halation is separate from the sharp source; no per-frame blur cost.
  const bloom=document.createElement('canvas');bloom.width=Math.ceil(canvas.width/3);bloom.height=Math.ceil(canvas.height/3);
  const bc=bloom.getContext('2d',{willReadFrequently:true});bc.drawImage(light,0,0,bloom.width,bloom.height);
  c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='screen';
  c.filter='blur(9px)';c.globalAlpha=.4*appearance.glow;c.drawImage(bloom,0,0,canvas.width,canvas.height);
  c.filter='blur(2px)';c.globalAlpha=.55*appearance.glow;c.drawImage(light,0,0);
  c.filter='none';c.globalAlpha=1;c.drawImage(light,0,0);
  c.globalCompositeOperation='source-over';
  // Release the light surfaces before allocating the persistent structure layer.
  light.width=light.height=bloom.width=bloom.height=0;
  const foreground=document.createElement('canvas');foreground.width=canvas.width;foreground.height=canvas.height;
  const fc=foreground.getContext('2d',{willReadFrequently:true});
  fc.scale(resolution,resolution);fc.translate(-bounds[0],-bounds[1]);
  paintBuildings(fc,buildings,activity,appearance.glow);
  return {canvas,foreground,bounds,resolution};
}
