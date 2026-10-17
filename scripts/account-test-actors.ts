/** Controlled counterparties for the opt in registered account journey. Never imports its custody key. */
import './rpc-transport';
import './studio-lock';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {generatePrivateKey} from 'viem/accounts';
import {TransactionHashVariant, type CalldataEncodable, type TransactionHash} from 'genlayer-js/types';
import {transactionJournal} from './tx-journal';
import {inspectReceipt,jsonSafe} from '../lib/receipt';
import deployment from '../deployments/studio.json';

process.umask(0o077);
const folder=process.env.BALLAST_ACCOUNT_TEST_DIR??'artifacts/account-tests';
await mkdir(folder,{recursive:true,mode:0o700});
const path=folder+'/actors.json';
const operator=process.env.BALLAST_ACCOUNT_ADDRESS;
assert.match(operator??'',/^0x[a-fA-F0-9]{40}$/,'Supply the authenticated public account address');
type Check = {hash:string;done?:boolean;receipt?:ReturnType<typeof inspectReceipt>};
type ActorState = {operator:string;keys:Record<string,`0x${string}`>;checks:Record<string,Check>;funded:Record<string,boolean>;vaults:Record<string,`0x${string}`>;history?:Record<string,unknown>;incidents?:Record<string,unknown>;historyReady?:boolean};
let state: ActorState; // Tooling state stays in the ignored owner only directory.
try {state=JSON.parse(await readFile(path,'utf8'));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={operator:operator!,keys:{claimant:generatePrivateKey(),first:generatePrivateKey(),second:generatePrivateKey(),third:generatePrivateKey()},checks:{},funded:{},vaults:{}};}
assert.equal(state.operator,operator,'A journey cannot change account');
async function save(){await writeFile(path+'.tmp',JSON.stringify(jsonSafe(state),null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);}
await save();
const actors=Object.fromEntries(await Promise.all(Object.entries(state.keys as Record<string,`0x${string}`>).map(async([name,key])=>[name,await transactionJournal(folder+'/'+name+'.journal',key)] as const)));
assert.ok(Object.values(actors).every(a=>a.account.address.toLowerCase()!==operator!.toLowerCase()),'Controlled actors must never be the registered account');
async function write(name:string,actor:string,address:`0x${string}`,method:string,args:CalldataEncodable[]=[],value=0n){
 if(state.checks[name]?.done)return;
 const a=actors[actor];
 const hash=state.checks[name]?.hash??await a.submit(name,{address,method,args,value},()=>a.client.writeContract({address,functionName:method,args,value,leaderOnly:false}));
 state.checks[name]={hash};await save();console.log(name+' submitted '+hash);
 const receipt=inspectReceipt(await a.wait(hash as TransactionHash));
 assert.equal(receipt.execution,'success');state.checks[name]={hash,done:true,receipt};await save();console.log(name+' finalized successfully');
}
const stage=process.env.BALLAST_ACCOUNT_STAGE??'history';
if(stage==='history'){
 const code=await readFile('tests/integration/contracts/incident_vault.py','utf8');
 for(const[name,a]of Object.entries(actors)){
  if(!state.funded[name]){
   const balance=await a.client.getBalance({address:a.account.address});
   assert.equal(balance,0n,'Only a newly generated zero balance actor may use setup funding');
   await a.client.request({method:'sim_fundAccount',params:[a.account.address,25*10**18]});
   state.funded[name]=true;await save();
  }
 }
 for(const name of ['first','second','third']){
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
 console.log('Three actual executor histories prepared; no registered account funds or existing capital were touched.');
}else if(stage==='incident'){
 const name=process.env.BALLAST_ACCOUNT_EXECUTOR??'first';assert.ok(state.historyReady);
 await write(name+'_incident',name,state.vaults[name],'spend_without_approval',[2n*10n**17n,actors[name].account.address]);
 state.incidents??={};state.incidents[name]=await actors[name].client.readContract({address:state.vaults[name],functionName:'get_evidence',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});await save();
}else throw Error('Unknown account testing stage');
const publicState={operator:state.operator,addresses:Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.account.address])),vaults:state.vaults,checks:state.checks,history:state.history,incidents:state.incidents,historyReady:state.historyReady};
await writeFile(folder+'/actors-public.json',JSON.stringify(jsonSafe(publicState),null,2)+'\n',{mode:0o600});
