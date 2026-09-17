import { project } from "./shared/geometry.js";

const modes = new Set(['rail','subway','light_rail','tram']);
export function underground(tags) {
  return tags.tunnel === 'yes' || tags.location === 'underground' || Number(tags.layer) < 0;
}
export function parseRail(raw, center) {
  const tracks=(raw.elements||[]).filter(e=>e.type==='way'&&modes.has(e.tags?.railway)&&e.geometry?.length>1)
    .map(e=>({id:e.id,sourceId:`way/${e.id}`,tags:e.tags,nodes:e.nodes,points:e.geometry.filter(p=>p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>project(p.lon,p.lat,center))}))
    .filter(e=>e.nodes?.length===e.points.length);
  const stations=(raw.elements||[]).filter(e=>e.type==='node'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon))
    .map(e=>({id:e.id,sourceId:`node/${e.id}`,name:e.tags?.name||'',tags:e.tags||{},point:project(e.lon,e.lat,center)}));
  return {tracks,stations,source:raw.pocketPlaces};
}
export async function loadRail(id,center) {
  const response=await fetch(`${import.meta.env.BASE_URL}data/${id}-rail.json`);
  if(!response.ok)throw new Error('Rail snapshot unavailable');
  return parseRail(await response.json(),center);
}
export function buildRailRoutes(rail, bounds) {
  const edges=[],adj=new Map();
  const add=(id,e)=>{if(!adj.has(id))adj.set(id,[]);adj.get(id).push(e)};
  for(const track of rail.tracks) {
    if(['yard','siding','spur','crossover'].includes(track.tags.service))continue;
    for(let i=1;i<track.points.length;i++){
      const a=track.points[i-1],b=track.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.2)continue;
      const e={id:edges.length,a,b,from:track.nodes[i-1],to:track.nodes[i],length,track};edges.push(e);add(e.from,e);add(e.to,e);
    }
  }
  const used=new Set(),routes=[];
  const starts=[...edges].sort((a,b)=>(adj.get(a.from).length===1?-1:0)-(adj.get(b.from).length===1?-1:0)||b.length-a.length);
  for(const seed of starts) {
    if(used.has(seed.id))continue;
    let e=seed,node=adj.get(seed.to).length===1?seed.to:seed.from,dir=null,total=0;
    const parts=[];
    for(let i=0;e&&i<10000;i++) {
      if(used.has(e.id))break;
      used.add(e.id);
      const forward=e.from===node,a=forward?e.a:e.b,b=forward?e.b:e.a;
      dir=[(b[0]-a[0])/e.length,(b[1]-a[1])/e.length];
      parts.push({a,b,start:total,length:e.length,hidden:underground(e.track.tags),mode:e.track.tags.railway});total+=e.length;
      node=forward?e.to:e.from;
      const options=(adj.get(node)||[]).filter(next=>!used.has(next.id)&&next.track.tags.railway===seed.track.tags.railway);
      const score=next=>{const q=next.from===node?next.b:next.a;return ((q[0]-b[0])*dir[0]+(q[1]-b[1])*dir[1])/next.length;};
      options.sort((a,b)=>score(b)-score(a));
      e=options.find(next=>score(next)>-.35);
      if(total>18000)break;
    }
    if(total<260)continue;
    const inBounds=p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3];
    const visibleLength=parts.reduce((sum,p)=>sum+(inBounds(p.a)||inBounds(p.b)?p.length:0),0);
    if(visibleLength<180)continue;
    const stops=[];
    for(const station of rail.stations){
      let best=null;
      for(const p of parts){
        const dx=p.b[0]-p.a[0],dy=p.b[1]-p.a[1],t=Math.max(0,Math.min(1,((station.point[0]-p.a[0])*dx+(station.point[1]-p.a[1])*dy)/(p.length*p.length)));
        const distance=Math.hypot(station.point[0]-p.a[0]-dx*t,station.point[1]-p.a[1]-dy*t);
        if(distance<45&&(!best||distance<best.distance))best={distance,s:p.start+t*p.length};
      }
      if(best&&best.s>90&&best.s<total-90&&!stops.some(s=>Math.abs(s-best.s)<130))stops.push(best.s);
    }
    const visibleParts=parts.filter(p=>inBounds(p.a)||inBounds(p.b));
    routes.push({parts,length:total,visibleLength,visibleStart:visibleParts[0].start,stops:stops.sort((a,b)=>a-b),mode:seed.track.tags.railway});
  }
  return routes.sort((a,b)=>b.visibleLength-a.visibleLength).slice(0,24);
}
export function railPosition(route,distance) {
  if(distance<0||distance>route.length)return null;
  let low=0,high=route.parts.length-1;
  while(low<high){const mid=(low+high)>>1;if(route.parts[mid].start+route.parts[mid].length<distance)low=mid+1;else high=mid;}
  const p=route.parts[low],t=(distance-p.start)/p.length;
  return {x:p.a[0]+(p.b[0]-p.a[0])*t,y:p.a[1]+(p.b[1]-p.a[1])*t,angle:Math.atan2(p.b[1]-p.a[1],p.b[0]-p.a[0]),hidden:p.hidden};
}
// Deterministic staged departures; dwell points come from mapped stations.
export function trainState(route,time,index=0) {
  const speed=route.mode==='tram'?10:route.mode==='rail'?20:16, dwell=9;
  const travel=route.length/speed+route.stops.length*dwell;
  const entry=route.visibleStart||0;
  const offset=entry/speed+route.stops.filter(s=>s<entry).length*dwell;
  let clock=(time+offset+index*13)%(travel+24),distance=0;
  if(clock>travel)return null;
  for(const stop of [...route.stops,route.length]) {
    const duration=(stop-distance)/speed;
    if(clock<duration)return {s:distance+clock*speed,dwelling:false};
    clock-=duration;distance=stop;
    if(stop!==route.length){if(clock<dwell)return {s:stop,dwelling:true};clock-=dwell;}
  }
  return {s:route.length,dwelling:false};
}
export function drawRail(c,rail,routes,time,{aerial=false,trains=true,xray=false,zoom=1}={}) {
  c.save();c.lineJoin='round';c.lineCap='round';
  for(const track of rail.tracks){
    const hidden=underground(track.tags);if(hidden&&!xray)continue;
    const yard=!!track.tags.service;
    c.beginPath();track.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));
    c.setLineDash(hidden?[5,9]:[]);c.strokeStyle=hidden?'#639696':aerial?'#668f83':'#608983';c.globalAlpha=hidden?.3:yard?.2:.45;c.lineWidth=hidden?1.2:yard?1:2.2;c.stroke();
    if(!hidden&&!yard){c.setLineDash([1,8]);c.lineWidth=5;c.globalAlpha=.18;c.stroke();}
  }
  c.setLineDash([]);
  // Station lighting is only visible at the surface unless the diagram overlay is on.
  for(const station of rail.stations){
    if(underground(station.tags)&&!xray)continue;
    c.globalAlpha=.6;c.fillStyle='#bedacc';c.beginPath();c.arc(...station.point,2,0,Math.PI*2);c.fill();
  }
  if(trains)for(let i=0;i<routes.length;i++){
    const route=routes[i],state=trainState(route,time,i);if(!state)continue;
    const carriageLength=route.mode==='tram'?11:16,cars=route.mode==='rail'?6:route.mode==='tram'?3:5;
    for(let car=0;car<cars;car++) {
      const p=railPosition(route,state.s-car*(carriageLength+2));if(!p||(p.hidden&&!xray))continue;
      c.save();c.translate(p.x,p.y);c.rotate(p.angle);
      c.globalAlpha=p.hidden?.38:1;
      c.shadowBlur=p.hidden?0:6;c.shadowColor='#a5e3d8';
      c.fillStyle=car===0?'#d1e8db':'#799e98';c.fillRect(-carriageLength/2,-1.8,carriageLength,3.6);
      c.shadowBlur=0;c.fillStyle='#f4edc2';
      for(let x=-carriageLength/2+2;x<carriageLength/2-1;x+=3)c.fillRect(x,-1.7,1.4,3.4);
      if(car===0){c.fillStyle='#fff5d5';c.fillRect(carriageLength/2-1,-2,2,4);}
      c.restore();
    }
  }
  c.restore();
}
