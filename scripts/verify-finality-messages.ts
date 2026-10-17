import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { abi } from "genlayer-js";
import { inspectReceipt } from "../lib/receipt";

// Public explorer records only. Never publish raw validator configurations.
type Transaction = {
  hash: string; status: string; from_address: string; to_address: string;
  triggered_by_hash: string | null; triggered_on: string | null;
  created_at: string; data: {calldata?: string};
  consensus_data: {leader_receipt: Record<string,unknown> | Record<string,unknown>[]};
};
const state = JSON.parse(await readFile(process.env.BALLAST_DEPLOYMENT_FILE??"deployments/review-integration.json","utf8"));
assert.equal(state.result,"passed","Complete the actual claimant withdrawal first");
const curl=promisify(execFile);
async function get(path:string) {
  const {stdout}=await curl("curl",["--fail","--silent","--show-error","--max-time","30","https://explorer-studio.genlayer.com/api/transactions"+path],{maxBuffer:4*1024*1024});
  return JSON.parse(stdout);
}
const transactions = new Map<string,Transaction>();
async function transaction(hash:string) {
  let record=transactions.get(hash);
  if(!record){record=(await get("/"+hash)).transaction as Transaction;transactions.set(hash,record);}
  return record;
}
const lists=new Map<string,Transaction[]>();
async function list(address:string) {
  let records=lists.get(address);
  if(!records){
    records=[];
    let page=1,totalPages=1;
    do {
      const response=await get("?address="+address+"&limit=50&page="+page);
      records.push(...response.transactions as Transaction[]);
      totalPages=Number(response.pagination.totalPages);
      assert.ok(Number.isSafeInteger(totalPages)&&totalPages>=0,"Invalid explorer pagination");
      page++;
    }while(page<=totalPages);
    lists.set(address,records);
  }
  return records;
}
function method(calldata:string) {
  const decoded=abi.calldata.decode(Buffer.from(calldata,"base64"));
  assert.ok(decoded instanceof Map,"Expected a named IC method call");
  return decoded.get("method");
}
const confirmations:Record<string,Record<string,unknown>>={};
for(const [name,parentHash,source,target,expected] of [
  ["agent",state.checks.register_agent.hash,state.registry,state.registry,"confirm_agent"],
  ["policy",state.checks.bind_policy.hash,state.underwriting,state.underwriting,"confirm_policy"],
  ["decision",state.checks.finalize_claim.hash,state.court,state.court,"confirm_claim"],
  ["settlement",state.checks.settle_claim.hash,state.underwriting,state.underwriting,"confirm_settlement"],
  ["acknowledgment",null,state.underwriting,state.court,"acknowledge_settlement"],
] as const){
  const parent=await transaction(parentHash??String(confirmations.settlement.child));
  const parentReceipt=inspectReceipt(parent);
  assert.equal(parentReceipt.status,"FINALIZED");assert.equal(parentReceipt.execution,"success");
  let proof:Transaction|undefined;
  for(const candidate of await list(target)){
    if(candidate.triggered_by_hash!==parent.hash||candidate.to_address.toLowerCase()!==target.toLowerCase())continue;
    const full=await transaction(candidate.hash);
    if(full.data.calldata&&method(full.data.calldata)===expected){proof=full;break;}
  }
  assert.ok(proof,"Missing actual emitted "+expected+" receipt");
  assert.equal(proof.from_address.toLowerCase(),source.toLowerCase());
  assert.equal(proof.triggered_on,"finalized");
  const receipt=inspectReceipt(proof);
  assert.equal(receipt.status,"FINALIZED");assert.equal(receipt.execution,"success");
  const leader=Array.isArray(parent.consensus_data.leader_receipt)?parent.consensus_data.leader_receipt[0]:parent.consensus_data.leader_receipt;
  const messages=leader.pending_transactions as {address:string;on:string;calldata:string}[];
  assert.ok(messages.some(m=>m.on==="finalized"&&m.address.toLowerCase()===target.toLowerCase()&&m.calldata===proof.data.calldata),"Child must carry the exact finalized parent message");
  confirmations[name]={parent:parent.hash,child:proof.hash,source,target,method:expected,triggeredOn:proof.triggered_on,createdAt:proof.created_at,receipt};
  console.log(expected+" verified against its finalized parent and authenticated sender");
}
await writeFile("docs/review-finality-result.json",JSON.stringify({network:"studionet",verifiedAt:new Date().toISOString(),registry:state.registry,underwriting:state.underwriting,court:state.court,confirmations,result:"passed",scope:"Actual Studio emitted child transactions, exact parent calldata, finalized triggers, authenticated senders and successful finalized execution. No raw validator configuration is included."},null,2)+"\n");
