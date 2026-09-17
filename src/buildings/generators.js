import { buildingProfile, ROOF_DIRECTION } from '../shared/building-profile.js';
import { buildingCenter, buildingArea } from '../lighting.js';
import { featureSeed, resolveHeight } from './heights.js';
import { random } from "../shared/random.js";

export const projectVertex = ([x,y,z], direction = ROOF_DIRECTION) => [x + direction[0] * z, y + direction[1] * z];

/** Small original parametric models, expressed in world metres before projection. */
export function generateStructure(feature, anchor, profile, direction = ROOF_DIRECTION) {
  const profiles = [], rods = [], art = profile.art, angle = art.rotation * Math.PI / 180, elevation=profile.baseElevation||0;
  const world = (x,y,z) => [anchor[0]+x*Math.cos(angle)-y*Math.sin(angle),anchor[1]+x*Math.sin(angle)+y*Math.cos(angle),z+elevation];
  const ring = width => [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>world(x*width/2,y*width/2,0).slice(0,2));
  const add = (bottom, top, width, upper = width, material = 'glass') => {
    const f = {...feature,id:feature.id+profiles.length*.001,sourceId:`${feature.sourceId}/section/${profiles.length}`,
      points:ring(width),holes:[],tags:{...feature.tags,building:'office'}};
    const b = buildingProfile(f,.5,{bottom:bottom+elevation,top:top+elevation,source:'profile',estimated:false},ring(upper),direction);
    b.material=material;b.model=true;b.assemblyId=feature.assemblyId||feature.sourceId;
    profiles.push(b);
  };
  const rod = (a,b,width=1,material=profile.id?'steel':'iron') => rods.push({kind:'rod',a:world(...a),b:world(...b),width,material,
    feature,assemblyId:feature.assemblyId||feature.sourceId});
  const h=profile.height,w=art.width;
  if (profile.generator === 'tiered') {
    // The mapped outline includes the shopping podium; only the anchored tower rises.
    if (!feature.sourceId.startsWith('node/')) {
      const podium=buildingProfile(feature,.5,{bottom:0,top:art.podium,source:'profile',estimated:false},feature.points,direction);
      podium.model=true;podium.assemblyId=feature.assemblyId||feature.sourceId;profiles.push(podium);
    }
    add(art.podium,art.base,w,w*.82);
    const step=(art.tierTop-art.base)/art.tiers;
    for(let i=0;i<art.tiers;i++) {
      const z=art.base+i*step, width=w*(1-i*.018);
      add(z,z+step-2,width*art.taper,width,'jade');
      add(z+step-2,z+step,width,width,'cornice');
    }
    add(art.tierTop,art.crown,w*.54,w*.48,'jade');
    add(art.crown,art.spireBase,w*.29,w*.19,'cornice');
    add(art.spireBase,h-9,w*.12,w*.045,'jade');
    rod([0,0,h-9],[0,0,h],1.2,'ivory');
  } else {
    const observation=art.observation, mastBase=art.mastBase;
    // Four splayed legs and open X bracing; no filled silhouette under the tower.
    const levels=[0,art.platform,observation*.56,observation-4,mastBase];
    const widths=[w,w*.65,w*.35,w*.22,w*.08];
    for(let j=0;j<levels.length-1;j++) {
      const z=levels[j],zt=levels[j+1],a=widths[j]/2,b=widths[j+1]/2;
      for(let i=0;i<4;i++) {
        const corners=[[-1,-1],[1,-1],[1,1],[-1,1]],s=corners[i],t=corners[(i+1)%4];
        rod([s[0]*a,s[1]*a,z],[s[0]*b,s[1]*b,zt],j===0?1.5:1);
        rod([s[0]*a,s[1]*a,z],[t[0]*b,t[1]*b,zt],.65);
        rod([t[0]*a,t[1]*a,z],[s[0]*b,s[1]*b,zt],.65);
        rod([s[0]*b,s[1]*b,zt],[t[0]*b,t[1]*b,zt],.8);
      }
    }
    if(art.podium>0)add(0,art.podium,w*.62,w*.62,'stone');
    if(profile.id && art.platform>0)add(art.platform-3,art.platform+2,w*.86,w*.86,'stone');
    if(art.observationWidth>0) {
      add(observation-4,observation+3,art.observationWidth,art.observationWidth,'observatory');
      add(observation+3,observation+6,art.observationWidth*1.12,art.observationWidth*.45,'green-roof');
    }
    if(art.clock>0)add(art.clock-3,art.clock+3,w*.5,w*.5,'clock');
    rod([0,0,mastBase],[0,0,h],1.1,'ivory');
  }
  return {profiles,rods};
}

export function genericTower(feature) {
  const area=buildingArea(feature.points),height=resolveHeight(feature,area,random(featureSeed(feature))());
  const width=Math.max(3,Math.min(30,Math.sqrt(area)));
  const span=height.top-height.bottom;
  // A neutral tapering frame without another landmark's clock, decks or colour identity.
  return {anchor:buildingCenter(feature.points),profile:{generator:'lattice',height:span,baseElevation:height.bottom,
    art:{rotation:0,width,podium:0,platform:span*.22,observation:span*.72,observationWidth:0,mastBase:span*.9,clock:0}}};
}
