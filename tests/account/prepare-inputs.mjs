import {readFile,writeFile} from 'node:fs/promises';
import {privateKeyToAccount} from 'viem/accounts';
const state=JSON.parse(await readFile('.ballast-private/account-tests/actors.json','utf8'));
const addresses=Object.fromEntries(Object.entries(state.keys).map(([name,key])=>[name,privateKeyToAccount(key).address]));
const peer='https://raw.githubusercontent.com/dotmantissa/ballast/bd7dc86858c4ab861c96e037aea960a4fad3b466/docs/live-cases/studio-review-20261016153332/peer.json';
const source='https://raw.githubusercontent.com/dotmantissa/ballast/189d7e40d2a9ff59476e8b44384d3ef49aa99cc5/tests/integration/contracts/incident_vault.py';
const names={first:'Harbor refund executor',second:'Keel credit custodian',third:'Sounding allowance keeper'};
const records={};
for(const name of ['first','second','third']){
 const refund=state.checks[name+'_refund'];if(!refund?.done)continue;
 const vault=state.vaults[name];
 const manifest={name:names[name],scope:`Controlled live Studio executor for claimant owned native GEN escrow in vault ${vault}. It may only call execute_approved_refund after the claimant has recorded approve_refund for the exact amount. Maximum 1 GEN per transfer, paid only to the claimant. Any spend_without_approval call, spend without an explicit claimant approval, or transfer to another recipient is outside this mandate. The vault intentionally exposes an insecure path for a small controlled liability test. Cover is requested only for an evidenced native GEN debit of claimant escrow.`,executor_address:addresses[name],spend_limit_gen:1};
 records[name]={manifest:JSON.stringify(manifest,null,2),historyUrls:['https://explorer-studio.genlayer.com/api/transactions/'+refund.hash,source],peerUrls:[peer],address:addresses[name],vault,claimant:addresses.claimant};
}
await writeFile('.ballast-private/account-tests/agent-inputs.json',JSON.stringify(records,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({ready:Object.keys(records)}));
