// Visual activity is inferred from mapped buildings, not measured population or radiance.
export function buildingArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum / 2);
}
export function buildingCenter(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y); }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
export function commerce(tags) {
  return ['commercial','retail','hotel','train_station','office'].includes(tags.building) || !!tags.shop || !!tags.office || ['hotel','museum','attraction'].includes(tags.tourism);
}
export function landmark(tags, area) {
  return area > 300 && (!!tags.historic || ['museum','attraction'].includes(tags.tourism) || ['train_station','stadium'].includes(tags.building) || Number.parseFloat(tags.height) >= 90 || Number.parseFloat(tags['building:levels']) >= 25);
}
export function activityField(buildings, size = 180) {
  const cells = new Map();
  for (const f of buildings) {
    const [x,y] = buildingCenter(f.points), ar = buildingArea(f.points);
    if (!Number.isFinite(x+y) || ar < 8) continue;
    const key = Math.floor(x/size)+','+Math.floor(y/size);
    cells.set(key,(cells.get(key)||0) + Math.min(2.5,0.4+ar/800)*(commerce(f.tags)?2.2:1));
  }
  return (x,y) => {
    const gx = x/size, gy = y/size, ix = Math.floor(gx), iy = Math.floor(gy);
    let weight = 0, total = 0;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      const falloff = Math.exp(-((gx-ix-dx-.5)**2+(gy-iy-dy-.5)**2)*1.4);
      total += (cells.get((ix+dx)+','+(iy+dy))||0)*falloff; weight += falloff;
    }
    return Math.min(1,Math.log1p(total/Math.max(1,weight))/3.5);
  };
}
export function roadEmission(tags) {
  if (tags.tunnel === 'yes' || tags.lit === 'no') return 0;
  return ({motorway:1, motorway_link:.86,trunk:.95,trunk_link:.8,primary:.9,primary_link:.75,secondary:.68,secondary_link:.6,tertiary:.43,tertiary_link:.35,residential:.2,unclassified:.18,living_street:.13,service:.09,pedestrian:.16,footway:.025,path:.012,cycleway:.018,steps:.012})[tags.highway] || 0;
}

// Shared spatial fields, in metres. No per-city exposure normalization: a quiet
// district should stay quiet rather than become that tile's brightest district.
export function districtField(city) {
  const density=activityField(city.buildings), cells=new Map(), step=240;
  function seed(x,y,radius,strength,kind){
    const reach=radius*2.5;
    for(let gx=Math.floor((x-reach)/step);gx<=Math.floor((x+reach)/step);gx++)
      for(let gy=Math.floor((y-reach)/step);gy<=Math.floor((y+reach)/step);gy++){
        const key=gx+','+gy;if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push({x,y,radius,strength,kind});
      }
  }
  for(const building of city.buildings){
    if(!commerce(building.tags))continue;
    const [x,y]=buildingCenter(building.points),area=buildingArea(building.points);
    seed(x,y,160+Math.min(90,Math.sqrt(area)*.5),Math.min(1.8,.3+area/5000),'commerce');
  }
  // Multiple platforms/entrances do not multiply one station's district glow.
  const stations=[];
  for(const station of city.rail?.stations||[]){
    const tags=station.tags;
    if(!['station','halt'].includes(tags.railway))continue;
    if(stations.some(p=>Math.hypot(p[0]-station.point[0],p[1]-station.point[1])<200))continue;
    stations.push(station.point);
    const metro=tags.station==='subway'||tags.subway==='yes';
    seed(...station.point,metro?180:290,metro?.7:1,'station');
  }
  // Find true shared-node crossings; bends, parallel carriageways and tunnels
  // never receive a bright intersection merely because drawn lines overlap.
  const junctions=new Map();
  for(const road of city.roads){
    if(roadEmission(road.tags)<.4||road.tags.bridge==='yes')continue;
    road.points.forEach((p,i)=>{
      const id=road.nodes?.[i];if(id===undefined)return;
      if(!junctions.has(id))junctions.set(id,{p,arms:new Set()});
      const j=junctions.get(id);
      if(i>0)j.arms.add(road.nodes[i-1]);if(i<road.points.length-1)j.arms.add(road.nodes[i+1]);
    });
  }
  for(const j of junctions.values())if(j.arms.size>=4)seed(...j.p,70,.8,'junction');
  return (x,y)=>{
    let commercial=0,station=0,junction=0;
    for(const s of cells.get(Math.floor(x/step)+','+Math.floor(y/step))||[]){
      const d2=((x-s.x)**2+(y-s.y)**2)/(s.radius*s.radius);
      if(d2>6.25)continue;
      const value=Math.exp(-d2*1.5)*s.strength;
      if(s.kind==='commerce')commercial+=value;
      else if(s.kind==='station')station=Math.max(station,value);
      else junction=Math.max(junction,value);
    }
    return Math.min(1.2,.12+density(x,y)*.2+.72*(1-Math.exp(-commercial/2.8))+station*.6+junction*.16);
  };
}

// Low-frequency spatial variation makes whole stretches dimmer, not random
// per-frame flicker or discontinuities at OSM way boundaries.
export function streetVariation(x,y){
  return .58+.24*Math.sin(x/113+y/157)+.18*Math.sin(x/47-y/83);
}
