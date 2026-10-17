/** Controlled counterparties for the opt in registered account journey. Never imports its custody key. */
import './rpc-transport';
import './studio-lock';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {generatePrivateKey} from 'viem/accounts';
import {TransactionHashVariant, type CalldataEncodable, type TransactionHash} from 'genlayer-js/types';
import {transactionJournal} from './tx-journal';
import {inspectReceipt,jsonSafe} from '../lib/receipt';
import deployment from '../deployments/studio.json';

async function main() {
process.umask(0o077);
const folder=process.env.BALLAST_ACCOUNT_TEST_DIR??'.ballast-private/account-tests';
const localPath=relative(resolve('.ballast-private'),resolve(folder));
assert.ok(localPath&&!localPath.startsWith('..')&&!localPath.startsWith('/'),'Keep actor state within the private project directory');
await mkdir(folder,{recursive:true,mode:0o700});
const path=folder+'/actors.json';
const operator=process.env.BALLAST_ACCOUNT_ADDRESS;
assert.match(operator??'',/^0x[a-fA-F0-9]{40}$/,'Supply the authenticated public account address');
type Check = {hash:string;done?:boolean;expectedExecution?:string;rejectionReason?:string;receipt?:ReturnType<typeof inspectReceipt>};
type CaseRecord = {id:string;policyId:string;incidentRef:string;incidentAt:number;amount:string;statement:string;evidenceUrls:string[]};
type ActorState = {operator:string;keys:Record<string,`0x${string}`>;checks:Record<string,Check>;funded:Record<string,boolean>;vaults:Record<string,`0x${string}`>;history?:Record<string,unknown>;incidents?:Record<string,unknown>;historyReady?:boolean;claims?:Record<string,CaseRecord>};
let state: ActorState; // Tooling state stays in the ignored owner only directory.
try {state=JSON.parse(await readFile(path,'utf8'));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;assert.equal(process.env.BALLAST_CREATE_ACCOUNT_ACTORS,'1','Missing actor state: explicitly select a new private run before creating actors');state={operator:operator!,keys:{claimant:generatePrivateKey(),first:generatePrivateKey(),second:generatePrivateKey(),third:generatePrivateKey()},checks:{},funded:{},vaults:{}};}
assert.equal(state.operator,operator,'A journey cannot change account');
async function save(){
 const content=JSON.stringify(jsonSafe(state),null,2)+'\n';
 await writeFile(path+'.tmp',content,{mode:0o600});await rename(path+'.tmp',path);
 const backup='.git/ballast-account-tests-backup/'+localPath;
 await mkdir(backup,{recursive:true,mode:0o700});await writeFile(backup+'/actors.json.tmp',content,{mode:0o600});await rename(backup+'/actors.json.tmp',backup+'/actors.json');
}
await save();
const actors=Object.fromEntries(await Promise.all(Object.entries(state.keys as Record<string,`0x${string}`>).map(async([name,key])=>[name,await transactionJournal(folder+'/'+name+'.journal',key)] as const)));
assert.ok(Object.values(actors).every(a=>a.account.address.toLowerCase()!==operator!.toLowerCase()),'Controlled actors must never be the registered account');
async function write(name:string,actor:string,address:`0x${string}`,method:string,args:CalldataEncodable[]=[],value=0n,expectedExecution='success'){
 if(state.checks[name]?.done)return;
 const a=actors[actor];
 const hash=state.checks[name]?.hash??await a.submit(name,{address,method,args,value},()=>a.client.writeContract({address,functionName:method,args,value,leaderOnly:false}));
 state.checks[name]={hash};await save();console.log(name+' submitted '+hash);
 let receipt;
 try{receipt=inspectReceipt(await a.wait(hash as TransactionHash));}
 catch(error){if(expectedExecution!=='error'||!(error as {finalFailure?:boolean}).finalFailure)throw error;receipt=inspectReceipt(await a.client.getTransaction({hash:hash as TransactionHash}));}
 assert.equal(receipt.status,'FINALIZED');assert.equal(receipt.execution,expectedExecution);state.checks[name]={hash,done:true,expectedExecution,receipt};await save();console.log(name+' finalized with expected '+expectedExecution);
}
const stage=process.env.BALLAST_ACCOUNT_STAGE??'history';
const caseId=process.env.BALLAST_ACCOUNT_CASE??'registered-account-20261017';
assert.match(caseId,/^[a-z0-9-]+$/);
if(stage==='history'){
 const executors=(process.env.BALLAST_ACCOUNT_EXECUTORS??'first,second,third').split(',');
 assert.ok(executors.length>0&&executors.every(name=>['first','second','third'].includes(name)));
 const code=await readFile('tests/integration/contracts/incident_vault.py','utf8');
 for(const[name,a]of Object.entries(actors)){
  if(name!=='claimant'&&!executors.includes(name))continue;
  if(!state.funded[name]){
   const balance=await a.client.getBalance({address:a.account.address});
   assert.equal(balance,0n,'Only a newly generated zero balance actor may use setup funding');
   await a.client.request({method:'sim_fundAccount',params:[a.account.address,25*10**18]});
   state.funded[name]=true;await save();
  }
 }
 for(const name of executors){
  const a=actors[name];
  await write(name+'_authorize',name,deployment.registry as `0x${string}`,'authorize_operator',[operator!]);
  if(!state.vaults[name]){
   const hash=state.checks[name+'_deploy']?.hash??await a.submit(name+'_deploy',{code,args:[actors.claimant.account.address,a.account.address]},()=>a.client.deployContract({code:new TextEncoder().encode(code),args:[actors.claimant.account.address,a.account.address],leaderOnly:false}));
   state.checks[name+'_deploy']={hash};await save();console.log(name+' vault submitted '+hash);
   const receipt=await a.wait(hash as TransactionHash);
   state.vaults[name]=String(receipt.txDataDecoded&&'contractAddress'in receipt.txDataDecoded?receipt.txDataDecoded.contractAddress:receipt.to_address??receipt.recipient) as `0x${string}`;
   assert.match(state.vaults[name],/^0x[0-9a-f]{40}$/i);state.checks[name+'_deploy'].done=true;await save();
  }
  const vault=state.vaults[name];
  await write(name+'_deposit','claimant',vault,'deposit',[],10n**18n);
  await write(name+'_approve','claimant',vault,'approve_refund',[10n**17n]);
  await write(name+'_refund',name,vault,'execute_approved_refund');
  const evidence=await a.client.readContract({address:vault,functionName:'get_evidence',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
  assert.equal((evidence as Record<string,unknown>).escrow_wei,'900000000000000000');
  state.history??={};state.history[name]=evidence;await save();
 }
 state.historyReady=true;await save();
 console.log(executors.length+' actual executor histories prepared; no registered account funds or existing capital were touched.');
}else{
 const name=process.env.BALLAST_ACCOUNT_EXECUTOR??'first';
 const round=process.env.BALLAST_ACCOUNT_CLAIM_ROUND??'1';
 const caseKey=name+'_'+round;
 const court=deployment.court as `0x${string}`;
 async function read(address:`0x${string}`,method:string,args:CalldataEncodable[]=[]){return actors[name].client.readContract({address,functionName:method,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL});}
 if(stage==='ownership'){
  await write(name+'_ownership_refusal',name,deployment.registry as `0x${string}`,'authorize_operator',[actors.claimant.account.address],0n,'error');
 }else if(stage==='incident'){
  assert.ok(state.historyReady);
  const policy=JSON.parse(await readFile(folder+'/policy-'+name+'.json','utf8'));
  const actual=await read(deployment.underwriting as `0x${string}`,'get_final_policy',[policy.id]) as {operator:string;status:string};
  assert.equal(actual.operator.toLowerCase(),operator!.toLowerCase());assert.equal(actual.status,'active');
  await write(name+'_incident',name,state.vaults[name],'spend_without_approval',[2n*10n**17n,actors[name].account.address]);
  state.incidents??={};state.incidents[name]=await read(state.vaults[name],'get_evidence');await save();
 }else if(stage==='claim'){
  const policy=JSON.parse(await readFile(folder+'/policy-'+name+'.json','utf8'));
  const evidence=JSON.parse(await readFile(folder+'/evidence.json','utf8'));
  assert.match(evidence.incidentCommit,/^[a-f0-9]{40}$/);
  const incident=state.incidents?.[name] as {loss:{occurred_at:number;amount_wei:string}};
  assert.ok(incident?.loss);
  const incidentRef=state.checks[name+'_incident'].hash;
  const evidenceUrls=['https://explorer-studio.genlayer.com/api/transactions/'+incidentRef,'https://raw.githubusercontent.com/dotmantissa/ballast/'+evidence.incidentCommit+'/docs/live-cases/'+caseId+'/'+name+'-incident.json'];
  const statement='Controlled Studio test: this claimant deposited their own native GEN in vault '+state.vaults[name]+'. The insured executor made the referenced unapproved debit of 0.2 GEN to itself after coverage began. This is an actual deliberate test of the insecure vault, not a customer allegation. No repayment has occurred. Request 0.1 GEN within the shared policy limit, supported by the exact finalized root transaction and signed incident record.';
  await write(caseKey+'_file','claimant',court,'file_claim',[policy.id,incidentRef,incident.loss.occurred_at,10n**17n,statement,evidenceUrls],10n**16n);
  const page=await read(court,'list_account_claims',[actors.claimant.account.address,false,-1,50]) as {items:{id:string;incident_ref:string;policy_id:string}[]};
  const claim=page.items.find(c=>c.incident_ref===incidentRef&&c.policy_id===policy.id);assert.ok(claim);
  state.claims??={};state.claims[caseKey]={id:claim.id,policyId:policy.id,incidentRef,incidentAt:incident.loss.occurred_at,amount:'100000000000000000',statement,evidenceUrls};await save();
  await writeFile(folder+'/claim-'+caseKey+'.json',JSON.stringify(state.claims[caseKey],null,2)+'\n',{mode:0o600});
  await writeFile(folder+'/active-claim.json',JSON.stringify(state.claims[caseKey],null,2)+'\n',{mode:0o600});
 }else{
  const claim=state.claims?.[caseKey];assert.ok(claim,'File the real case first');
  if(stage==='audit'){
   let finalClaim;for(let attempt=0;attempt<12;attempt++){
    try{finalClaim=await read(court,'get_final_claim',[claim.id]);break;}
    catch{console.log('Waiting for the actual finalized court confirmation.');await new Promise(resolve=>setTimeout(resolve,15000));}
   }
   assert.ok(finalClaim,'Court confirmation still pending; resume this read only audit');
   const audit={observedAt:new Date().toISOString(),claim:await read(court,'get_claim',[claim.id]),finalClaim,finalSettlement:await read(deployment.underwriting as `0x${string}`,'get_final_settlement',[claim.id]),policy:await read(deployment.underwriting as `0x${string}`,'get_final_policy',[claim.policyId]),lossRecord:await read(deployment.registry as `0x${string}`,'get_loss_record',[operator!]),claimantPool:await read(deployment.underwriting as `0x${string}`,'get_account',[actors.claimant.account.address]),claimantCourt:await read(court,'get_account_cases',[actors.claimant.account.address]),claimantBalance:(await actors.claimant.client.getBalance({address:actors.claimant.account.address})).toString()};
   await writeFile(folder+'/audit-'+caseKey+'.json',JSON.stringify(jsonSafe(audit),null,2)+'\n',{mode:0o600});
  }else if(stage==='withdraw_case')await write(caseKey+'_withdraw','claimant',court,'withdraw_claim',[claim.id]);
  else if(stage==='duplicate_claim'){
   // Use another still open policy so exhaustion cannot mask the global event guard.
   const original=JSON.parse(await readFile('.ballast-private/account-tests/policy-first.json','utf8'));
   assert.notEqual(original.id,claim.policyId);
   const target=await read(deployment.underwriting as `0x${string}`,'get_final_policy',[original.id]) as {status:string;remaining:string;starts_at:number;ends_at:number};
   assert.equal(target.status,'active');assert.ok(BigInt(target.remaining)>=10n**17n);assert.ok(target.starts_at<=claim.incidentAt&&claim.incidentAt<=target.ends_at);
   const resolved=await read(court,'get_claim',[claim.id]) as {event_key:string};
   const event=await read(deployment.underwriting as `0x${string}`,'get_final_event_record',[resolved.event_key]) as {paid:string};assert.ok(BigInt(event.paid)>0n);
   await write(caseKey+'_duplicate_refusal','claimant',court,'file_claim',[original.id,claim.incidentRef.toUpperCase().replace('0X','0x'),claim.incidentAt,10n**17n,claim.statement,claim.evidenceUrls],10n**16n,'error');
   const full=await actors.claimant.client.getTransaction({hash:state.checks[caseKey+'_duplicate_refusal'].hash as TransactionHash});
   const receipts=full.consensus_data?.leader_receipt;
   const leader=Array.isArray(receipts)?receipts[0]:receipts;
   const result=leader?.result as unknown;
   let reason='';
   if(typeof result==='object'&&result!==null&&'payload' in result&&typeof result.payload==='string')reason=result.payload;
   else if(typeof result==='string'){
    const bytes=Buffer.from(result,'base64');if([1,2].includes(bytes[0]))reason=bytes.subarray(1).toString('utf8');
   }
   assert.match(reason,/This claimant loss has already been compensated/);
   state.checks[caseKey+'_duplicate_refusal'].rejectionReason='This claimant loss has already been compensated';await save();
  }
  else if(stage==='claimant_appeal'||stage==='claimant_payout_appeal'){
   const payout=stage==='claimant_payout_appeal';
   if(payout){
    const current=await read(court,'get_claim',[claim.id]) as {status:string;findings:{harm:boolean;causation:boolean;scope:boolean};verified_loss:string;event_key:string};
    assert.equal(current.status,'challenge');assert.equal(current.findings.harm,true);assert.equal(current.findings.causation,true);assert.equal(current.findings.scope,false);assert.equal(current.verified_loss,'200000000000000000');
    const compensated=await read(deployment.underwriting as `0x${string}`,'get_final_event_record',[current.event_key]) as {paid:string};assert.equal(compensated.paid,'0');
   }
   const reason=payout?'Please reconsider payout using the actual Ballast v1 coverage rule. The agent mandate is NOT the policy coverage boundary: unauthorized native spending OUTSIDE that mandate is the covered peril. The court payout rubric explicitly says zero if scope is TRUE, not when scope is FALSE. This case already has harm=true, causation=true, scope=false and verified_loss=200000000000000000. Its requested amount is only 100000000000000000. The earlier case was withdrawn and its finalized settlement paid ZERO, so there is no prior compensation. The initial payout reason cites spend_without_approval as excluded by the mandate; that is exactly why this debit is unauthorized, not proof of a policy exclusion. Please fetch the existing signed actual incident and root transaction again and independently determine the supported fraction under this rule. No new loss, refund or facts are alleged.':'Please independently verify the scope finding against the registered approval rule and exact root transaction. This controlled test asks each party to exercise its own review right. The public source records show the actual debit without claimant approval; do not treat this request as new facts.';
   const sources=payout?[...claim.evidenceUrls,'https://raw.githubusercontent.com/dotmantissa/ballast/189d7e40d2a9ff59476e8b44384d3ef49aa99cc5/README.md']:claim.evidenceUrls;
   await write(caseKey+(payout?'_claimant_payout_appeal':'_claimant_appeal'),'claimant',court,'appeal_finding',[claim.id,payout?'payout':'scope',reason,sources],10n**16n);
  }else if(stage==='claimant_accept')await write(caseKey+'_claimant_accept','claimant',court,'accept_decision',[claim.id]);
  else if(stage==='claimant_withdraw'){
   const paymentPath=folder+'/withdrawal-'+caseKey+'.json';
   let payment:{beforeWei:string;payoutWei:string;bondWei:string;afterWei?:string;exactNativeIncrease?:boolean};
   try{payment=JSON.parse(await readFile(paymentPath,'utf8'));}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const account=await read(deployment.underwriting as `0x${string}`,'get_account',[actors.claimant.account.address]) as {credit:string};
    const cases=await read(court,'get_account_cases',[actors.claimant.account.address]) as {bond_credit:string};
    payment={beforeWei:(await actors.claimant.client.getBalance({address:actors.claimant.account.address})).toString(),payoutWei:account.credit,bondWei:cases.bond_credit};
   }
   async function savePayment(){
    const content=JSON.stringify(payment,null,2)+'\n';await writeFile(paymentPath+'.tmp',content,{mode:0o600});await rename(paymentPath+'.tmp',paymentPath);
    const backup='.git/ballast-account-tests-backup/'+localPath;await mkdir(backup,{recursive:true,mode:0o700});await writeFile(backup+'/withdrawal-'+caseKey+'.json',content,{mode:0o600});
   }
   if(!payment.exactNativeIncrease){
    await savePayment();
    if(BigInt(payment.payoutWei)>0n)await write(caseKey+'_claimant_payout','claimant',deployment.underwriting as `0x${string}`,'withdraw');
    if(BigInt(payment.bondWei)>0n)await write(caseKey+'_claimant_bonds','claimant',court,'withdraw_bonds');
    const expected=BigInt(payment.beforeWei)+BigInt(payment.payoutWei)+BigInt(payment.bondWei);
    for(let attempt=0;attempt<12;attempt++){
     payment.afterWei=(await actors.claimant.client.getBalance({address:actors.claimant.account.address})).toString();
     if(BigInt(payment.afterWei)===expected)break;
     await new Promise(resolve=>setTimeout(resolve,15000));
    }
    assert.equal(BigInt(payment.afterWei!),expected);payment.exactNativeIncrease=true;await savePayment();
   }
  }else throw Error('Unknown account testing stage');
 }
}
const publicState={operator:state.operator,addresses:Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.account.address])),vaults:state.vaults,checks:state.checks,history:state.history,incidents:state.incidents,historyReady:state.historyReady,claims:state.claims};
await writeFile(folder+'/actors-public.json',JSON.stringify(jsonSafe(publicState),null,2)+'\n',{mode:0o600});

}
await main().catch(() => { console.error("Controlled actor operation stopped. Its saved journal must be inspected before retrying."); process.exitCode = 1; });
