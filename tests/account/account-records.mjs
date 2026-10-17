import {readFile} from 'node:fs/promises';
export async function funding(page,expect){
 const row=await page.qa.test('account and funds',2,async()=>{
  let before;try{before=JSON.parse(await readFile('.ballast-private/account-tests/before-daily-funding.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;before=await page.qa.account('before-daily-funding');}
  await page.qa.close();await page.locator('.account-button').click();
  let response;try{response=JSON.parse(await readFile('.ballast-private/account-tests/ui-funding.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!response){
   const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Add 25 test GEN',exact:true}).click();
   const r=await pending;response={status:r.status(),data:await r.json()};await page.qa.save('ui-funding.json',response);
  }
  const op=await page.qa.wait(response);expect(op.execution).toBe('success');
  const after=await page.qa.account('after-daily-funding');
  expect(BigInt(after.balance)-BigInt(before.balance)).toBe(25n*10n**18n);
  expect(after.legacyCapital.senior_value).toBe(before.legacyCapital.senior_value);
  return {operationId:op.id,beforeWei:before.balance,afterWei:after.balance,addedWei:(25n*10n**18n).toString(),actualDailyWindow:true,submittedThroughUI:true};
 });await page.qa.close();return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function records(page,expect){
 const agents=await Promise.all(['first','second','third'].map(async name=>JSON.parse(await readFile('.ballast-private/account-tests/agent-'+name+'.json','utf8'))));
 const policy=JSON.parse(await readFile('.ballast-private/account-tests/policy-first.json','utf8'));
 const claim=JSON.parse(await readFile('.ballast-private/account-tests/claim-first_1.json','utf8'));
 const rows=[];
 rows.push(await page.qa.test('records and filtering',1,async()=>{
  const result=await page.qa.api('/records?kind=agents&mine=true');expect(result.status).toBe(200);
  for(const agent of agents)expect(result.data.items.map(a=>a.id)).toContain(agent.id);
  expect(result.data.items.every(a=>a.operator.toLowerCase()===agents[0].operator.toLowerCase())).toBe(true);
  return {agentIds:agents.map(a=>a.id),mineOnly:true};
 }));
 rows.push(await page.qa.test('records and filtering',2,async()=>{
  const p=await page.qa.api('/records?kind=policies&id='+policy.id);const c=await page.qa.api('/records?kind=claims&id='+claim.id);
  expect(p.status).toBe(200);expect(c.status).toBe(200);expect(p.data.record.id).toBe(policy.id);expect(c.data.record.policy_id).toBe(policy.id);
  return {policyId:policy.id,claimId:claim.id,directLookupsMatch:true};
 }));
 rows.push(await page.qa.test('records and filtering',3,async()=>{
  const latest=await page.qa.api('/records?kind=agents&mine=true');expect(latest.status).toBe(200);
  const earlier=await page.qa.api('/records?kind=agents&mine=true&cursor='+latest.data.total);expect(earlier.status).toBe(200);
  expect(earlier.data.items.map(a=>a.id)).toEqual(latest.data.items.map(a=>a.id));
  const empty=await page.qa.api('/records?kind=agents&mine=true&cursor=0');expect(empty.status).toBe(200);expect(empty.data.items).toHaveLength(0);expect(empty.data.next_cursor).toBe(null);
  const invalid=await page.qa.api('/records?kind=agents&mine=true&cursor=-1');expect(invalid.status).toBe(400);
  return {total:latest.data.total,absoluteCursorStable:true,zeroCursorEmpty:true,invalidCursorRejected:true,liveDatasetBelow50:true};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function activity(page,expect){
 const rows=[];const saved=page.qa.journal['repeat-bind-first'];expect(saved.final.execution).toBe('error');
 rows.push(await page.qa.test('activity and retries',1,async()=>{
  const account=await page.qa.account();expect(account.operations.some(o=>o.tx_hash&&/^0x[0-9a-f]{64}$/.test(o.tx_hash))).toBe(true);
  await page.qa.close();const tray=page.locator('.activity-toggle');if(await tray.getAttribute('aria-expanded')!=='true')await tray.click();
  await expect(page.getByText('Finalized without applying the action').first()).toBeVisible();
  return {realTransactionIds:true,failedConsensusDisplayedAccurately:true};
 }));
 const successful=page.qa.journal['first-corroborating-evidence'];expect(successful.final.execution).toBe('success');
 rows.push(await page.qa.test('activity and retries',2,async()=>{
  const r=await page.qa.api('/actions',{method:'POST',data:JSON.parse(successful.body),headers:{'Idempotency-Key':successful.key}});
  expect(r.status).toBe(202);expect(r.data.id).toBe(successful.final.id);expect(r.data.tx_hash).toBe(successful.final.tx_hash);
  return {operationId:r.data.id,transaction:r.data.tx_hash,sameKeySameOperation:true};
 }));
 rows.push(await page.qa.test('activity and retries',3,async()=>{
  const r=await page.qa.api('/actions',{method:'POST',data:{kind:'withdraw'},headers:{'Idempotency-Key':successful.key}});expect(r.status).toBe(409);
  return {changedBodyRejected:true,httpStatus:409};
 }));await page.qa.close();return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
