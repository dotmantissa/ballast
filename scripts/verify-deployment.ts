import "./rpc-transport";
import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
const path=process.env.BALLAST_DEPLOYMENT_FILE??"deployments/studio.json";
const state=JSON.parse(await readFile(path,"utf8"));
const client=createClient({chain:studionet});
const curl=promisify(execFile);
for(const [name,file]of [["registry","agent_registry"],["underwriting","underwriting"],["court","claims_court"]]){
  const {stdout}=await curl("curl",["--fail","--silent","--show-error","--max-time","30","https://explorer-studio.genlayer.com/api/transactions/"+state.transactions[name]],{maxBuffer:2*1024*1024});
  const record=JSON.parse(stdout).transaction;
  assert.equal(record.status,"FINALIZED");
  assert.equal(record.to_address.toLowerCase(),state[name].toLowerCase());
  const deployed=Buffer.from(record.data.contract_code,"base64");
  const local=await readFile("contracts/"+file+".py");
  assert.deepEqual(deployed,local,"Deployed source differs: "+name);
  assert.equal(createHash("sha256").update(local).digest("hex"),state.sourceHashes[name]);
  const schema=await client.getContractSchema(state[name]);
  assert.ok(JSON.stringify(schema).length>500);
  console.log(name+" finalized source and schema match");
}
async function read(name:string,method:string){return await client.readContract({address:state[name],functionName:method,args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}) as Record<string,unknown>;}
const registry=await read("registry","get_config");
const pool=await read("underwriting","get_dashboard");
const court=await read("court","get_config");
assert.equal(String(registry.underwriting).toLowerCase(),state.underwriting.toLowerCase());
assert.equal(String(pool.court).toLowerCase(),state.court.toLowerCase());
assert.equal(String(court.registry).toLowerCase(),state.registry.toLowerCase());
assert.equal(String(court.underwriting).toLowerCase(),state.underwriting.toLowerCase());
if(process.env.BALLAST_REQUIRE_EMPTY==="1"){
  assert.equal(String(pool.tvg),"0");assert.equal(Number(registry.agent_count),0);assert.equal(Number(court.claim_count),0);assert.equal(Number(pool.policy_count),0);
}
state.network="studionet";state.chainId=61999;
state.sourceVerifiedAt=new Date().toISOString();
await writeFile(path+".tmp",JSON.stringify(state,null,2)+"\n");await rename(path+".tmp",path);
console.log("Finalized deployment links verified"+(process.env.BALLAST_REQUIRE_EMPTY==="1"?"; production pool is empty.":"."));
