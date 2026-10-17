import assert from "node:assert/strict";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const load=async(path:string)=>JSON.parse(await readFile(path,"utf8"));
const candidate=await load("deployments/reviewer-release.json");
const live=await load("docs/review-integration-result.json");
const finality=await load("docs/review-finality-result.json");
assert.equal(live.result,"passed");assert.equal(finality.result,"passed");
assert.equal(live.court,finality.court);
assert.equal(Object.keys(finality.confirmations).length,5);
assert.equal(candidate.network,"studionet");assert.equal(candidate.chainId,61999);
assert.ok(candidate.wired?.wire_registry&&candidate.wired?.wire_pool);
for(const [name,file]of [["registry","agent_registry"],["underwriting","underwriting"],["court","claims_court"]]){
  assert.match(candidate[name],/^0x[0-9a-f]{40}$/i);
  const digest=createHash("sha256").update(await readFile("contracts/"+file+".py")).digest("hex");
  assert.equal(candidate.sourceHashes[name],digest);
  assert.equal(live.sourceHashes[name],digest,"The real claim must exercise the promoted source");
}
const current=await load("deployments/studio.json");
if(current.underwriting.toLowerCase()===candidate.underwriting.toLowerCase()){
  const previous=await load("deployments/previous-studio.json");
  assert.notEqual(previous.underwriting.toLowerCase(),candidate.underwriting.toLowerCase());
  console.log("This verified release is already promoted; earlier capital access is preserved.");
}else{
  const inspected=Date.parse(candidate.emptyVerifiedAt??"");
  assert.ok(Number.isFinite(inspected)&&Date.now()-inspected<10*60*1000,"Verify the clean production deployment with BALLAST_REQUIRE_EMPTY=1 immediately before promotion");
  const previous=await load("deployments/previous-studio.json");
  if(previous.underwriting.toLowerCase()!==current.underwriting.toLowerCase()){
    assert.match(previous.underwriting,/^0x[0-9a-f]{40}$/i);
    await mkdir("deployments/archive",{recursive:true});
    const archive="deployments/archive/"+previous.underwriting.toLowerCase()+".json";
    try { await writeFile(archive,JSON.stringify(previous,null,2)+"\n",{flag:"wx"}); }
    catch(error){
      if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      assert.deepEqual(await load(archive),previous,"Do not overwrite a different deployment archive");
    }
  }
  for(const [path,record]of [["deployments/previous-studio.json",current],["deployments/studio.json",candidate]] as const){
    await writeFile(path+".tmp",JSON.stringify(record,null,2)+"\n");await rename(path+".tmp",path);
  }
  console.log("Promoted verified empty contracts. Earlier capital remains at "+current.underwriting+" with explicit withdrawal access.");
}
