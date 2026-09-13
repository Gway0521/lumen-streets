import { selectLandmarks } from './landmarks.js';

const smooth = t => { t=Math.max(0,Math.min(1,t));return t*t*(3-2*t); };
/** A few separated real places, never random cool patches or a viewport-dependent selection. */
export function streetColorField(city) {
  const anchors=[];
  for(const place of selectLandmarks(city)) {
    if(!place.accent || anchors.some(a=>Math.hypot(a.point[0]-place.point[0],a.point[1]-place.point[1])<600))continue;
    let hash=0;for(const c of place.sourceId)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
    anchors.push({...place,radius:Math.min(300,200+Math.sqrt(place.area)*.45),color:[[211,224,220],[180,212,230],[184,224,208]][hash%3]});
    if(anchors.length===3)break;
  }
  const sample=(x,y)=>{
    const warm=.5+.28*Math.sin(x/330+y/510)+.22*Math.cos(x/570-y/290);
    let cool=0,color=[211,224,220];
    for(const a of anchors){const distance=Math.hypot(x-a.point[0],y-a.point[1])/a.radius,weight=(1-smooth((distance-.3)/.7))*.94;
      if(weight>cool){cool=weight;color=a.color;}}
    return {warm,cool,color};
  };
  return {anchors,sample};
}

export function tintStreet(rgb, tone) {
  // Related amber / gold / pale-yellow hues, with an equal field at both ends of split ways.
  const warm=[rgb[0],rgb[1]+(tone.warm-.5)*64,rgb[2]+(tone.warm-.5)*38];
  return warm.map((v,i)=>Math.round(Math.max(0,Math.min(255,v+(tone.color[i]-v)*tone.cool))));
}
