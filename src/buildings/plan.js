import { matchLandmarks } from './catalog.js';

const baseId = f => f.sourceId.replace(/\/outer\/\d+$/, '');
const inherited = ['tower:construction', 'tower:type', 'man_made'];
const annexes = new Set(['annex','entrance','porch','garage']);
const enclosed = tags => ['observatory','observation','room'].includes(tags['building:part']) ||
  ['glass','brick','stone','concrete'].includes(tags['building:material']);

/** Assembly identity survives even when its outline is not a drawable volume.
 * Heights/materials stay component-local: total height is never copied to every part. */
export function assembleBuildings(features) {
  const groups=new Map();
  for(const f of features) {
    const id=f.assemblyId||f.sourceId;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(f);
  }
  return [...groups].map(([id,members])=>{
    const outline=members.find(f=>f.role==='outline')||members.find(f=>f.role!=='part')||members[0];
    const identity={...outline.relationTags,...outline.tags};
    return {id,outline,identity,members:members.map(f=>{
      const tags={...f.tags};
      if(f.role==='part'&&!annexes.has(tags['building:part'])&&!enclosed(tags))
        for(const key of inherited)if(!tags[key]&&identity[key])tags[key]=identity[key];
      return {source:f,feature:{...f,tags},kind:annexes.has(tags['building:part'])?'annex':
        ['roof','platform'].includes(tags['building:part'])||tags.building==='roof'?'platform':enclosed(tags)?'solid':
        tags['tower:construction']==='lattice'||tags.man_made==='mast'?'frame':'solid'};
    })};
  });
}

/** Reviewed sources are replaced explicitly. Spatial part replacement is bounded by
 * the model envelope and the assembly; unrelated/identified annexes remain visible. */
export function resolveRenderPlan(city, profiles) {
  const assemblies=assembleBuildings(city.buildings),normal=[],models=[],bindings=[];
  const {matches}=matchLandmarks(city,profiles);
  for(const assembly of assemblies) {
    const found=assembly.members.find(m=>matches.has(m.source));
    const candidate=found&&matches.get(found.source);
    const match=candidate?.profile.replace?.keep.includes(baseId(found.source))?undefined:candidate;
    const wholeFrame=!match&&assembly.members.length>1&&
      (assembly.identity['tower:construction']==='lattice'||assembly.identity.man_made==='mast');
    if(wholeFrame)normal.push({feature:{...assembly.outline,tags:assembly.identity},kind:'frame'});
    const replaced=[],retained=[];
    for(const member of assembly.members) {
      const f=member.source,rule=match?.profile.replace;
      const exact=rule?.sources.includes(baseId(f));
      const part=rule&&f.role==='part'&&member.kind!=='annex'&&f.points.every(p=>Math.hypot(p[0]-match.anchor[0],p[1]-match.anchor[1])<=rule.partsWithin);
      const duplicate=match&&baseId(f).startsWith('node/')&&f.tags.wikidata===match.profile.wikidata;
      const replace=match&&!rule?.keep.includes(baseId(f))&&(f===found.source||exact||part||duplicate);
      if(replace)replaced.push(f.sourceId);
      else if(f.role!=='outline'&&!(wholeFrame&&member.kind==='frame')) {normal.push(member);retained.push(f.sourceId);}
    }
    if(match) {
      models.push({feature:found.source,...match});
      bindings.push({assemblyId:assembly.id,profile:match.profile.id,replaced,retained});
    }
  }
  return {normal,models,bindings};
}
