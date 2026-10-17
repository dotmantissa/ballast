import "./rpc-transport";
import "./studio-lock";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { transactionJournal } from "./tx-journal";
import { TransactionHashVariant, type TransactionHash } from "genlayer-js/types";
const state=JSON.parse(await readFile(process.env.BALLAST_DEPLOYMENT_FILE??"deployments/review-integration.json","utf8"));
const registry=process.env.BALLAST_PROBE_REGISTRY??state.registry;
const agentId=process.env.BALLAST_PROBE_AGENT_ID??state.agentId;
if(!/^0x[0-9a-f]{40}$/i.test(registry??"")||!agentId)throw Error("Provide a registered registry and agent ID through the deployment record or BALLAST_PROBE_REGISTRY and BALLAST_PROBE_AGENT_ID");
const path=".git/ballast-finality-probe-"+createHash("sha256").update(registry.toLowerCase()).digest("hex").slice(0,12)+".json";
let saved: Record<string, string> = {};
try { saved=JSON.parse(await readFile(path,"utf8")); } catch { /* First probe. */ }
const journal=await transactionJournal(path+".journal",process.env.GENLAYER_DEPLOYER_KEY as `0x${string}`);
const code=await readFile("tests/integration/contracts/finality_probe.py","utf8");
const digest=createHash("sha256").update(code).digest("hex");
if(!saved.address){
 const hash=await journal.submit("deploy",{digest,registry},()=>journal.client.deployContract({code:new TextEncoder().encode(code),args:[registry],leaderOnly:false}));
 saved.hash=hash;await writeFile(path,JSON.stringify(saved),{mode:0o600});console.log("Read probe submitted "+hash);
 const receipt=await journal.wait(hash as TransactionHash);
 saved.address=String(receipt.txDataDecoded&&"contractAddress" in receipt.txDataDecoded?receipt.txDataDecoded.contractAddress:(receipt.to_address??receipt.recipient));
 await writeFile(path,JSON.stringify(saved),{mode:0o600});
}
for(const method of ["read_latest_agent","read_final_agent"]){
 const started=Date.now();
 try {
  const agent=await journal.client.readContract({address:saved.address as `0x${string}`,functionName:method,args:[agentId],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}) as Record<string,unknown>;
  console.log(method+" returned agent "+agent.id+" in "+(Date.now()-started)+"ms");
 } catch { console.log(method+" failed or timed out in "+(Date.now()-started)+"ms"); }
}
