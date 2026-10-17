import {readFile} from 'node:fs/promises';
export async function roleProofs(page,expect){
 const actors=JSON.parse(await readFile('.ballast-private/account-tests/actors-public.json','utf8'));
 const out=[];
 out.push(await page.qa.test('executor authorization',1,async()=>{
  for(const name of ['first','second','third']){
   expect(actors.checks[name+'_authorize'].done).toBe(true);expect(actors.checks[name+'_authorize'].receipt.execution).toBe('success');
   const agent=JSON.parse(await readFile('.ballast-private/account-tests/agent-'+name+'.json','utf8'));
   expect(agent.operator.toLowerCase()).toBe(actors.operator.toLowerCase());expect(agent.executor_address.toLowerCase()).toBe(actors.addresses[name].toLowerCase());
  }
  return {threeSeparateExecutors:true,operator:actors.operator,transactions:['first','second','third'].map(n=>actors.checks[n+'_authorize'].hash)};
 }));
 out.push(await page.qa.test('executor authorization',2,async()=>{
  const input=JSON.parse(await readFile('.ballast-private/account-tests/agent-inputs.json','utf8')).first;
  const manifest=JSON.parse(input.manifest);manifest.name='Unapproved executor test';manifest.executor_address=actors.addresses.claimant;
  const op=await page.qa.execute('unauthorized-executor-registration',{kind:'register',manifest:JSON.stringify(manifest),historyUrls:input.historyUrls,publicConsent:true},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,unapprovedExecutorRejected:true};
 }));
 out.push(await page.qa.test('executor authorization',3,async()=>{
  const check=actors.checks.first_ownership_refusal;expect(check.done).toBe(true);expect(check.receipt.execution).toBe('error');
  expect(check.receipt.votes.filter(v=>v.vote.toLowerCase()==='agree').length).toBeGreaterThanOrEqual(2);
  return {transaction:check.hash,registeredOwnershipFixed:true};
 }));
 return out.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
export async function excessRedemption(page,expect){
 const row=await page.qa.test('capital redemption',2,async()=>{
  const op=await page.qa.execute('excess-junior-shares',{kind:'redeem',tranche:'junior',shares:'100000000000000000000'},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,excessSharesRejected:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
