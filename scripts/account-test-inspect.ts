/** Read only reconciliation of public chain records after an authorized live account journey. */
import './rpc-transport';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {TransactionHashVariant,type CalldataEncodable} from 'genlayer-js/types';
import {jsonSafe} from '../lib/receipt';
import deployment from '../deployments/studio.json';
import earlier from '../deployments/previous-studio.json';

async function main(){
 process.umask(0o077);
 const account=process.env.BALLAST_ACCOUNT_ADDRESS;assert.match(account??'',/^0x[a-f0-9]{40}$/i);
 const folder='.ballast-private/account-tests';await mkdir(folder,{recursive:true,mode:0o700});
 const client=createClient({chain:studionet});
 const read=async(address:string,functionName:string,args:CalldataEncodable[]=[])=>jsonSafe(await client.readContract({address:address as `0x${string}`,functionName,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
 const active=JSON.parse(await readFile(folder+'/continuation/active-claim.json','utf8'));
 const original=JSON.parse(await readFile(folder+'/claim-first_1.json','utf8'));
 const result={observedAt:new Date().toISOString(),account,deployment,
  nativeWei:(await client.getBalance({address:account as `0x${string}`})).toString(),
  pool:await read(deployment.underwriting,'get_account',[account!]),
  earlierPool:await read(earlier.underwriting,'get_account',[account!]),
  dashboard:await read(deployment.underwriting,'get_dashboard'),
  lossRecord:await read(deployment.registry,'get_loss_record',[account!]),
  originalClaim:await read(deployment.court,'get_claim',[original.id]),
  additionalClaim:await read(deployment.court,'get_claim',[active.id]),
  additionalSettlement:await read(deployment.underwriting,'get_final_settlement',[active.id]),
  courtAccount:await read(deployment.court,'get_account_cases',[account!]),
  poolNativeWei:(await client.getBalance({address:deployment.underwriting as `0x${string}`})).toString(),
  courtNativeWei:(await client.getBalance({address:deployment.court as `0x${string}`})).toString(),
 };
 await writeFile(folder+'/public-chain-reconciliation.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log('Saved actual finalized public chain reconciliation. No signing key was loaded.');
}
await main().catch(()=>{console.error('Read only reconciliation is incomplete. Resume it without sending transactions.');process.exitCode=1;});
