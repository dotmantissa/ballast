import "./rpc-transport";
import assert from "node:assert/strict";
import { readFile, writeFile, rename, chmod, mkdir } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createHash } from "node:crypto";
import { TransactionHashVariant, type CalldataEncodable, type TransactionHash } from "genlayer-js/types";
import { transactionJournal } from "./tx-journal";
import { inspectReceipt, jsonSafe } from "../lib/receipt";

const statePath = process.env.BALLAST_DEPLOYMENT_FILE ?? "deployments/review-integration.json";
const state = JSON.parse(await readFile(statePath, "utf8"));
assert.ok(state.wired?.wire_pool, "Deploy and wire the isolated contracts first");
const keyPath = ".env.review-integration";
let keys: Record<string, `0x${string}`>;
try { keys = JSON.parse(await readFile(keyPath, "utf8")); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  keys = { claimant: generatePrivateKey(), peer: generatePrivateKey() };
  await writeFile(keyPath, JSON.stringify(keys), {mode:0o600});
  await chmod(keyPath,0o600);
}
const ownerKey = process.env.GENLAYER_DEPLOYER_KEY as `0x${string}`;
const owner = await transactionJournal(statePath+".owner.journal",ownerKey);
const claimant = await transactionJournal(statePath+".claimant.journal",keys.claimant);
const peer = await transactionJournal(statePath+".peer.journal",keys.peer);
const actors = {owner,claimant,peer};
state.checks ??= {};
state.caseId ??= "studio-review-"+new Date().toISOString().replace(/[^0-9]/g,"").slice(0,14);
state.actors = Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.account.address]));
const dir = "docs/live-cases/"+state.caseId;
await mkdir(dir,{recursive:true});
async function save() {
  await writeFile(statePath+".tmp",JSON.stringify(jsonSafe(state),null,2)+"\n");
  await rename(statePath+".tmp",statePath);
}
async function read(address: `0x${string}`, method: string, args: CalldataEncodable[] = []) {
  return await owner.client.readContract({address,functionName:method,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL}) as Record<string, unknown>;
}
async function write(name: string, actor: keyof typeof actors, address: `0x${string}`, method: string, args: CalldataEncodable[] = [], value = 0n) {
  if(state.checks[name]?.done)return;
  const a=actors[actor];
  const hash=state.checks[name]?.hash ?? await a.submit(name,{address,method,args,value},()=>a.client.writeContract({address,functionName:method,args,value,leaderOnly:false}));
  state.checks[name]={hash};await save();console.log(name+" submitted "+hash);
  const receipt=await a.wait(hash as TransactionHash);
  state.checks[name]={hash,done:true,receipt:inspectReceipt(receipt)};await save();console.log(name+" execution succeeded");
}
async function balance(address:`0x${string}`) {return await owner.client.getBalance({address});}
async function eventually(check:()=>Promise<boolean>,message:string) {
  for(let i=0;i<30;i++){if(await check())return;await new Promise(r=>setTimeout(r,12000));}
  throw Error(message);
}
async function signed(file:string,payload:unknown,signers:(keyof typeof actors)[]) {
  const message=JSON.stringify(jsonSafe(payload));
  const signatures=[];
  for(const name of signers){
    const key=name==="owner"?ownerKey:keys[name];const signer=privateKeyToAccount(key);
    const signature=await signer.signMessage({message});
    assert.ok(await verifyMessage({address:signer.address,message,signature}));
    signatures.push({name,address:signer.address,signature});
  }
  await writeFile(dir+"/"+file,JSON.stringify({message:JSON.parse(message),signed_message:message,signatures},null,2)+"\n");
}
const phase=process.env.BALLAST_REVIEW_PHASE??"history";
if(phase==="history"){
  for(const [name,a] of Object.entries(actors)){
    if(!state.funded?.[name]){
      // Studio faucet sets a balance. This controlled isolated exercise uses test GEN only.
      await a.client.request({method:"sim_fundAccount",params:[a.account.address,25*10**18]});
      state.funded={...state.funded,[name]:true};await save();
    }
  }
  const code=await readFile("tests/integration/contracts/incident_vault.py","utf8");
  state.vaultSourceHash=createHash("sha256").update(code).digest("hex");
  for(const name of ["owner","peer"] as const){
    const vaultKey=name==="owner"?"vault":"peerVault";
    if(!state[vaultKey]){
      const a=actors[name];
      const hash=await a.submit("deploy_"+vaultKey,{code,args:[claimant.account.address,a.account.address]},()=>a.client.deployContract({code:new TextEncoder().encode(code),args:[claimant.account.address,a.account.address],leaderOnly:false}));
      state.checks["deploy_"+vaultKey]={hash};await save();console.log(vaultKey+" submitted "+hash);
      const receipt=await a.wait(hash as TransactionHash);
      state[vaultKey]=receipt.txDataDecoded&&"contractAddress" in receipt.txDataDecoded?receipt.txDataDecoded.contractAddress:(receipt.to_address??receipt.recipient);
      assert.ok(state[vaultKey]);state.checks["deploy_"+vaultKey].done=true;await save();
    }
    await write(vaultKey+"_deposit","claimant",state[vaultKey],"deposit",[],10n**18n);
    await write(vaultKey+"_approve","claimant",state[vaultKey],"approve_refund",[10n**17n]);
    await write(vaultKey+"_refund",name,state[vaultKey],"execute_approved_refund");
    const evidence=await read(state[vaultKey],"get_evidence");
    assert.equal(evidence.escrow_wei,"900000000000000000");assert.equal(evidence.approved_wei,"0");assert.equal(evidence.loss,null);
    await signed(name==="owner"?"history.json":"peer.json",{
      description:"Controlled live Studio native refund history. These are actual finalized transactions and balances, not fabricated loss records. The test vault deliberately exposes an unapproved spend path for a later controlled incident. The executor mandate permits only claimant approved refunds, with a maximum 1 GEN per transfer.",
      network:"GenLayer Studio",vault:state[vaultKey],vault_source_sha256:state.vaultSourceHash,
      claimant:claimant.account.address,operator:actors[name].account.address,executor:actors[name].account.address,
      transactions:Object.fromEntries(["deposit","approve","refund"].map(k=>[k,{hash:state.checks[vaultKey+"_"+k].hash,url:"https://explorer-studio.genlayer.com/api/transactions/"+state.checks[vaultKey+"_"+k].hash}])),
      finalized_vault_state:evidence,
    },[name,"claimant"]);
  }
  state.historyReady=true;await save();console.log("History snapshots ready in "+dir+". Publish immutable evidence and save historyCommit before the incident phase.");
}else if(phase==="incident"){
  assert.match(state.historyCommit??"",/^[a-f0-9]{40}$/);
  const raw="https://raw.githubusercontent.com/dotmantissa/ballast/"+state.historyCommit+"/"+dir;
  const manifest=JSON.stringify({name:"Studio refund executor",scope:"This executor manages claimant owned native GEN escrow in vault "+state.vault+". It may only call execute_approved_refund after the claimant has recorded approve_refund for that exact amount. Maximum 1 GEN per transfer. It must return refunds to the claimant. Any spend_without_approval call or transfer to another recipient is expressly outside its authority, even though the test vault exposes that vulnerable path. V1 cover requested only for a native GEN debit of the claimant escrow.",executor_address:owner.account.address,spend_limit_gen:1});
  await write("register_agent","owner",state.registry,"register_agent",[manifest,[raw+"/history.json","https://explorer-studio.genlayer.com/api/transactions/"+state.checks.vault_refund.hash]]);
  state.agentId=createHash("sha256").update("genlayer-studio:"+owner.account.address.toLowerCase()).digest("hex").slice(0,24);await save();
  await write("stake_junior","owner",state.underwriting,"stake",["junior"],2n*10n**18n);
  await write("stake_senior","owner",state.underwriting,"stake",["senior"],2n*10n**18n);
  await write("quote_policy","owner",state.underwriting,"quote_policy",[state.agentId,10n**18n,[raw+"/peer.json"]]);
  const quotes=await owner.client.readContract({address:state.underwriting,functionName:"list_quotes",args:[0,50],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}) as Record<string,unknown>[];
  const quote=quotes.find(q=>q.agent_id===state.agentId);assert.ok(quote);state.quote=quote;await save();
  assert.notEqual(quote.band,"declined","Inspect the real validator reason; do not replace it with an approved fixture");
  await write("bind_policy","owner",state.underwriting,"bind_policy",[String(quote.id)],BigInt(String(quote.premium)));
  state.policy=await read(state.underwriting,"get_policy",[String(quote.id)]);await save();
  assert.equal(state.policy.status,"active");assert.equal(state.policy.remaining,"1000000000000000000");
  if(!state.preIncident){state.preIncident={recipientBalance:String(await balance(owner.account.address)),claimantBalance:String(await balance(claimant.account.address)),vault:await read(state.vault,"get_evidence")};await save();}
  await write("unapproved_debit","owner",state.vault,"spend_without_approval",[2n*10n**17n,owner.account.address]);
  const evidence=await read(state.vault,"get_evidence");
  const loss=evidence.loss as Record<string,unknown>;assert.equal(loss.amount_wei,"200000000000000000");assert.equal(loss.claimant_approval,false);assert.equal(evidence.escrow_wei,"700000000000000000");
  await eventually(async()=>await balance(owner.account.address)>=BigInt(state.preIncident.recipientBalance)+2n*10n**17n,"Misrouted native funds did not reach the recipient");
  state.loss=loss;state.incidentHash=state.checks.unapproved_debit.hash;await save();
  await signed("incident.json",{
    description:"Controlled live incident on the development network. The claimant funded the vault and owns its escrow. The executor made a real native debit without claimant approval. This exercise intentionally uses an insecure test vault; it is not an allegation about a real customer or a production agent. No repayment has occurred.",
    network:"GenLayer Studio",incident_ref:state.incidentHash,claimant:claimant.account.address,operator:owner.account.address,executor:owner.account.address,
    policy:state.policy,incident_at:loss.occurred_at,loss_wei:loss.amount_wei,
    transaction_url:"https://explorer-studio.genlayer.com/api/transactions/"+state.incidentHash,
    before:state.preIncident,after:{recipient_balance_wei:String(await balance(owner.account.address)),vault:evidence},
    mandate:JSON.parse(manifest),
  },["owner","claimant"]);
  state.incidentReady=true;await save();console.log("Incident snapshot ready. Publish it and save incidentCommit before the claim phase.");
}else if(phase==="claim"){
  assert.match(state.incidentCommit??"",/^[a-f0-9]{40}$/);
  const urls=["https://explorer-studio.genlayer.com/api/transactions/"+state.incidentHash,"https://raw.githubusercontent.com/dotmantissa/ballast/"+state.incidentCommit+"/"+dir+"/incident.json"];
  await write("file_claim","claimant",state.court,"file_claim",[state.policy.id,state.incidentHash,state.loss.occurred_at,BigInt(state.loss.amount_wei),"My own native GEN escrow was debited by the registered executor without approval in this exact Studio transaction. I authorized refunds only to myself after an explicit approve_refund entry. No approval was pending. The executor instead used spend_without_approval to misroute 0.2 GEN to its own address. The vault lost exactly 200000000000000000 wei of my funds and no repayment has occurred. This is a controlled live exercise using test GEN.",urls],10n**16n);
  state.claimId=await owner.client.readContract({address:state.court,functionName:"get_policy_claim",args:[state.policy.id],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});await save();
  for(const field of ["harm","causation","scope","payout"])await write("finding_"+field,"claimant",state.court,"resolve_finding",[state.claimId,field]);
  state.initialClaim=await read(state.court,"get_claim",[state.claimId]);await save();
  assert.equal(state.initialClaim.status,"challenge");
  assert.deepEqual(state.initialClaim.findings,{harm:true,causation:true,scope:false,payout:100});
  await write("appeal_scope","owner",state.court,"appeal_finding",[state.claimId,"scope","Please independently review the scope conclusion against the registered mandate and this actual debit. The test vault exposed this callable path, but the executor was expressly forbidden from using it without claimant approval. I ask for a precise scope review; I do not assert that technical access granted permission.",urls],10n**16n);
  state.appealedClaim=await read(state.court,"get_claim",[state.claimId]);await save();
  assert.equal((state.appealedClaim.findings as Record<string,unknown>).scope,false);
  await write("accept_claimant","claimant",state.court,"accept_decision",[state.claimId]);
  await write("accept_operator","owner",state.court,"accept_decision",[state.claimId]);
  await write("finalize_claim","claimant",state.court,"finalize_claim",[state.claimId]);
  state.finalClaim=await read(state.court,"get_claim",[state.claimId]);await save();assert.equal(state.finalClaim.payout,state.loss.amount_wei);
  await write("settle_claim","claimant",state.underwriting,"settle_claim",[state.claimId]);
  state.settlement=await read(state.underwriting,"get_settlement",[state.claimId]);await save();assert.equal(state.settlement.paid,state.loss.amount_wei);
  if((await read(state.court,"get_claim",[state.claimId])).status!=="settled")await write("acknowledge_settlement","claimant",state.court,"acknowledge_settlement",[state.claimId]);
  if(!state.beforeWithdraw){state.beforeWithdraw=String(await balance(claimant.account.address));await save();}
  await write("withdraw_claimant","claimant",state.underwriting,"withdraw");
  await eventually(async()=>await balance(claimant.account.address)>=BigInt(state.beforeWithdraw)+BigInt(state.loss.amount_wei),"Claim payment did not reach claimant balance");
  const account=await read(state.underwriting,"get_account",[claimant.account.address]);assert.equal(account.credit,"0");
  if(!state.beforeBondWithdraw){state.beforeBondWithdraw=String(await balance(claimant.account.address));await save();}
  await write("withdraw_bonds","claimant",state.court,"withdraw_bonds");
  await eventually(async()=>await balance(claimant.account.address)>=BigInt(state.beforeBondWithdraw)+2n*10n**16n,"Filing and upheld operator appeal bonds did not reach claimant");
  await write("sync_loss","owner",state.registry,"sync_loss",[state.claimId]);
  state.lossRecord=await read(state.registry,"get_loss_record",[owner.account.address]);assert.equal(state.lossRecord.paid,state.loss.amount_wei);
  state.completedAt=new Date().toISOString();state.result="passed";await save();
  await writeFile("docs/review-integration-result.json",JSON.stringify(jsonSafe({network:"studionet",verifiedAt:state.completedAt,sourceHashes:state.sourceHashes,registry:state.registry,underwriting:state.underwriting,court:state.court,vault:state.vault,peerVault:state.peerVault,actors:state.actors,historyCommit:state.historyCommit,incidentCommit:state.incidentCommit,caseId:state.caseId,checks:state.checks,policy:state.policy,initialClaim:state.initialClaim,appealedClaim:state.appealedClaim,finalClaim:await read(state.court,"get_claim",[state.claimId]),settlement:state.settlement,lossRecord:state.lossRecord,withdrawal:{before:state.beforeWithdraw,after:String(await balance(claimant.account.address)),paid:state.loss.amount_wei},result:"passed",scope:"Real controlled Studio native debit, actual public source retrieval and independent validator judgments, successful quote/bind, four findings, an upheld operator scope appeal, mutual acceptance, finalization, finalized pool settlement and claimant payout/bond withdrawals. Test vault is intentionally insecure. No production customer harm or mainnet value is asserted."}),null,2)+"\n");
  console.log("Full real Studio lifecycle passed, including claimant receipt of native funds.");
}else throw Error("Unknown review phase");
