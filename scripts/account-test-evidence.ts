/** Publishable attestations for actual controlled account tests, with a strict field allowlist. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {privateKeyToAccount} from 'viem/accounts';
import {verifyMessage} from 'viem';

process.umask(0o077);
const folder=process.env.BALLAST_ACCOUNT_TEST_DIR??'.ballast-private/account-tests';
const state=JSON.parse(await readFile(folder+'/actors.json','utf8'));
const caseId=process.env.BALLAST_ACCOUNT_CASE??'registered-account-20261017';
assert.match(caseId,/^[a-z0-9-]+$/);
const output='docs/live-cases/'+caseId;
await mkdir(output,{recursive:true});
for(const name of ['first','second','third']){
 if(!state.history?.[name])continue;
 const executor=privateKeyToAccount(state.keys[name]);
 const claimant=privateKeyToAccount(state.keys.claimant);
 const incident=state.incidents?.[name];
 const payload={
  purpose:'Controlled live registered account quality checks on GenLayer Studio. The vault intentionally exposes an insecure path for a small liability test. These records describe actual transactions, not customer allegations or fabricated claims.',
  network:'GenLayer Studio',operator:state.operator,executor:executor.address,claimant:claimant.address,vault:state.vaults[name],
  mandate:'Only execute_approved_refund after the claimant approves the exact amount, maximum 1 GEN per transfer, paid only to the claimant. All spend_without_approval calls and other recipients are outside scope.',
  source_url:'https://raw.githubusercontent.com/dotmantissa/ballast/189d7e40d2a9ff59476e8b44384d3ef49aa99cc5/tests/integration/contracts/incident_vault.py',
  history:state.history[name],
  transactions:Object.fromEntries(['authorize','deploy','deposit','approve','refund',...(incident?['incident']:[])].map(kind=>{
   const check=state.checks[name+'_'+kind];assert.ok(check?.done,'Only finalized successful transactions are attestable');
   return[kind,{hash:check.hash,url:'https://explorer-studio.genlayer.com/api/transactions/'+check.hash}];
  })),
  ...(incident?{incident_ref:state.checks[name+'_incident'].hash,incident_at:incident.loss.occurred_at,loss_wei:incident.loss.amount_wei,after:incident}:{}),
 };
 const message=JSON.stringify(payload);const signatures=[];
 for(const[role,signer]of [['executor',executor],['claimant',claimant]] as const){
  const signature=await signer.signMessage({message});assert.ok(await verifyMessage({address:signer.address,message,signature}));
  signatures.push({role,address:signer.address,signature});
 }
 const path=output+'/'+name+(incident?'-incident':'-history')+'.json';
 await writeFile(path,JSON.stringify({message:payload,signature_encoding:'Ethereum personal_sign over UTF8 JSON.stringify(message), preserving property order',signatures},null,2)+'\n',{mode:0o644});
 console.log('Wrote verified public attestation '+path);
}
