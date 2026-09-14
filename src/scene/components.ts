export type Material = 'glass' | 'silver' | 'stone' | 'rose' | 'ivory' | 'steel';
export type Component =
  {kind:'loft'; shape:'rectangle'|'circle'|'rounded-triangle'; material:Material; windows:boolean; sections:number[][]} |
  {kind:'ellipsoid'; material:Material; windows:boolean; center:number[]; radii:number[]} |
  {kind:'beam'; material:Material; a:number[]; b:number[]; radius:number};
export interface Replacement {sources:string[]; keep:string[]; partsWithin:number}
const fail=():never=>{throw new Error('Invalid building components');};
const num=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const keys=(v:any,list:string[])=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==list.length||!Object.keys(v).every(k=>list.includes(k)))fail();
};
const point=(v:any,h:number)=>Array.isArray(v)&&v.length===3&&num(v[0],-150,150)&&num(v[1],-150,150)&&num(v[2],0,h);
export function validateReplacement(v:Replacement) {
  keys(v,['sources','keep','partsWithin']);
  for(const list of [v.sources,v.keep])if(!Array.isArray(list)||list.length>64||new Set(list).size!==list.length||
    list.some(s=>typeof s!=='string'||!/^(way|node|relation)\/[1-9]\d{0,15}$/.test(s)))fail();
  if(!v.sources.length||!num(v.partsWithin,0,150)||v.keep.some(s=>v.sources.includes(s)))fail();
}

/** Count generated geometry before allocating it. Saved profiles contain data only. */
export function validateComponents(components:Component[],height:number) {
  if(!Array.isArray(components)||!components.length||components.length>40)fail();
  let budget=0;
  for(const c of components) {
    if(!c||!['glass','silver','stone','rose','ivory','steel'].includes(c.material))fail();
    if(c.kind==='loft') {
      keys(c,['kind','shape','material','windows','sections']);
      if(!['rectangle','circle','rounded-triangle'].includes(c.shape)||typeof c.windows!=='boolean'||
        !Array.isArray(c.sections)||c.sections.length<2||c.sections.length>24)fail();
      let previous=-1;
      for(const s of c.sections) {
        if(!Array.isArray(s)||s.length!==6||!num(s[0],0,height)||s[0]-previous<.1||
          !num(s[1],.2,200)||!num(s[2],.2,200)||!num(s[3],-180,180)||!num(s[4],-150,150)||!num(s[5],-150,150))fail();
        previous=s[0];
      }
      budget+=2*(c.shape==='rectangle'?4:24)*c.sections.length;
    } else if(c.kind==='ellipsoid') {
      keys(c,['kind','material','windows','center','radii']);
      if(typeof c.windows!=='boolean'||!point(c.center,height)||!Array.isArray(c.radii)||c.radii.length!==3||
        !c.radii.every(v=>num(v,.5,80))||c.center[2]-c.radii[2]<0||c.center[2]+c.radii[2]>height)fail();
      budget+=624;
    } else if(c.kind==='beam') {
      keys(c,['kind','material','a','b','radius']);
      if(!point(c.a,height)||!point(c.b,height)||!num(c.radius,.2,12)||Math.hypot(...c.a.map((v,i)=>v-c.b[i]))<.5)fail();
      budget+=32;
    } else fail();
  }
  if(budget>6000)fail();
  return budget;
}
