import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const load=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const candidate=await load('.ballast-private/v2/production.json');
const live=await load('docs/v2-integration-result.json');
const isolated=await load('.ballast-private/v2/integration.json');
const catalog=await load('deployments/catalog.json') as Record<string,unknown>[];
assert.equal(live.result,'passed');assert.equal(candidate.version,2);assert.ok(!candidate.isolatedTest);
assert.ok(candidate.wired?.wire_registry&&candidate.wired?.wire_pool);
assert.equal(candidate.sourceVerifiedAt,candidate.emptyVerifiedAt,'Promotion requires source and empty-state verification in the same inspection');
assert.ok(Date.now()-Date.parse(candidate.emptyVerifiedAt)<600000,'Reverify the empty production candidate immediately before promotion');
for(const [name,file] of [['registry','agent_registry'],['assurance','assurance'],['underwriting','underwriting'],['court','claims_court']]){
  assert.match(candidate[name],/^0x[a-f0-9]{40}$/i);
  const code=await readFile('contracts/v2/'+file+'.py','utf8');
  const digest=createHash('sha256').update(code).digest('hex');
  assert.equal(candidate.sourceHashes[name],digest,'Production source must match canonical bytes');
  const exercised=name==='assurance'?code.replace("previous['created_at'] + 86400","previous['created_at'] + 60").replace("min(_now() + 86400, a['review_deadline'])","min(_now() + 300, a['review_deadline'])"):code;
  assert.equal(live.sourceHashes[name],createHash('sha256').update(exercised).digest('hex'),'Live lifecycle must exercise canonical logic apart from explicit isolated timers');
}
const current=await load('deployments/studio.json');
assert.ok(catalog.some(d=>String(d.underwriting).toLowerCase()===current.underwriting.toLowerCase()),'Preserve the current deployment in the catalog');
const indexedLegacy=catalog.filter(d=>d.indexed&&!d.testOnly&&d.underwriting!==candidate.underwriting).map(d=>d.underwriting);
assert.deepEqual(candidate.legacyPools,indexedLegacy,'Production must consume authoritative preceding pool history');
const metadata=(record:Record<string,unknown>)=>Object.fromEntries(['network','chainId','registry','assurance','underwriting','court','sponsor','treasury','legacyPools','sourceHashes','transactions','wired','deploymentGeneration','verifiedAt','sourceVerifiedAt','emptyVerifiedAt','isolatedTest'].filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
const production={...metadata(candidate),id:'v2-production',label:'Ballast v2 assurance pool',version:2,indexed:true};
const example={...metadata(isolated),exampleAgent:isolated.agentId,id:'v2-isolated',label:'Isolated v2 Studio validation',version:2,indexed:true,testOnly:true};
const append=(entry:Record<string,unknown>)=>{const saved=catalog.find(d=>d.id===entry.id);if(saved)assert.equal(saved.underwriting,entry.underwriting,'Never overwrite another immutable generation');else catalog.push(entry);};
append(example);append(production);
for(const [path,record] of [['deployments/catalog.json',catalog],['deployments/studio.json',production]] as const){await writeFile(path+'.tmp',JSON.stringify(record,null,2)+'\n');await rename(path+'.tmp',path);}
console.log('V2 selected for new business; every preceding generation and its funds remain in place.');
