import { mkdir, writeFile } from 'node:fs/promises';
import { LANDMARK_PACK } from '../src/buildings/catalog.js';
import { metres } from '../src/buildings/heights.js';

// Maintenance only. Fetch a bounded batch of named entities, never on scene startup.
// Candidate facts do not overwrite reviewed artwork or the published pack.
await mkdir('.cache/landmarks',{recursive:true});
const reports=[];
for(const p of LANDMARK_PACK.profiles) {
  const url=`https://www.wikidata.org/wiki/Special:EntityData/${p.wikidata}.json`;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'LumenStreets/0.1 landmark-maintenance','Accept':'application/json'}});
  if(!response.ok)throw Error(`${p.wikidata}: HTTP ${response.status}`);
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4000000)throw Error('Wikidata entity exceeds maintenance limit');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8'),entity=JSON.parse(text).entities?.[p.wikidata];
  if(!entity||entity.id!==p.wikidata)throw Error('Mismatched entity');
  const heightCandidates=(entity.claims?.P2048||[]).map(c=>{
    const v=c.mainsnak?.datavalue?.value;
    const unit=v?.unit?.split('/').at(-1),suffix=unit==='Q11573'?' m':unit==='Q3710'?' ft':null;
    const height=suffix&&typeof v.amount==='string'?metres(v.amount.replace(/^\+/,'')+suffix):null;
    return {claim:c.id,rank:c.rank,raw:v,metres:height,qualifiers:c.qualifiers||{},references:c.references||[],conflict:height!==null&&Math.abs(height-p.height)>.1};
  });
  const report={profile:p.id,url,entity:p.wikidata,revision:entity.lastrevid,retrievedAt:new Date().toISOString(),publishedHeight:p.height,
    coordinates:entity.claims?.P625?.map(c=>c.mainsnak?.datavalue?.value)||[],heightCandidates};
  await writeFile(`.cache/landmarks/${p.wikidata}.json`,text);reports.push(report);
}
await writeFile('.cache/landmarks/candidates.json',JSON.stringify(reports,null,2)+'\n');
console.log('Saved bounded candidate facts in .cache/landmarks/candidates.json. Review measurement semantics and conflicts before editing the published pack.');
