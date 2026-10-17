import {readFile} from 'node:fs/promises';
export async function bind(page,expect,name,n=1){
 const quote=JSON.parse(await readFile('.ballast-private/account-tests/quote-'+name+'.json','utf8'));
 const agent=JSON.parse(await readFile('.ballast-private/account-tests/agent-'+name+'.json','utf8'));
 expect(quote.band).not.toBe('declined');
 const run=async()=>{
  let response;try{response=JSON.parse(await readFile('.ballast-private/account-tests/ui-bind-'+name+'.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!response){
   await page.qa.close();await page.getByRole('button',{name:'Agents & cover',exact:true}).click();
   await page.getByLabel('Record type').selectOption('quotes');await page.getByLabel('Full record ID').fill(quote.id);
   await page.getByRole('button',{name:'Find record',exact:true}).click();
   await page.locator('.quote-row').filter({hasText:agent.name}).getByRole('button',{name:'Review quote',exact:true}).first().click();
   await page.getByRole('checkbox').check();
   const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Pay premium and bind cover',exact:true}).click();
   const r=await pending;response={status:r.status(),data:await r.json()};await page.qa.save('ui-bind-'+name+'.json',response);
  }
  const op=await page.qa.wait(response);expect(op.execution).toBe('success');
  let result;
  for(let i=0;i<4;i++){result=await page.qa.api('/records?kind=policies&id='+quote.id);if(result.status===200)break;await new Promise(r=>setTimeout(r,20000));}
  expect(result.status).toBe(200);const policy=result.data.record;expect(policy.status).toBe('active');expect(policy.remaining).toBe(quote.limit);expect(policy.premium).toBe(quote.premium);
  await page.qa.save('policy-'+name+'.json',policy);
  return {policyId:policy.id,transaction:op.tx_hash,premiumWei:quote.premium,limitWei:quote.limit,submittedThroughUI:true};
 };
 if(n){const row=await page.qa.test('coverage binding',n,run);return {status:row.status,error:row.error,evidence:row.evidence};}
 return run();
}
export async function activeGuards(page,expect){
 const policy=JSON.parse(await readFile('.ballast-private/account-tests/policy-first.json','utf8'));
 const agent=JSON.parse(await readFile('.ballast-private/account-tests/agent-first.json','utf8'));
 const rows=[];
 rows.push(await page.qa.test('coverage binding',2,async()=>{
  const op=await page.qa.execute('repeat-bind-first',{kind:'bind',quoteId:policy.id},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,secondBindRejected:true};
 }));
 rows.push(await page.qa.test('manifest revisions',3,async()=>{
  const manifest=JSON.parse(agent.manifest);manifest.scope+=' Additional test scope revision while cover is active.';
  const op=await page.qa.execute('revise-covered-first',{kind:'revise',agentId:agent.id,manifest:JSON.stringify(manifest),historyUrls:agent.history_urls,publicConsent:true},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,coveredRevisionRejected:true};
 }));
 rows.push(await page.qa.test('capital redemption',3,async()=>{
  const a=await page.qa.account('active-cover-account');
  const op=await page.qa.execute('redeem-locked-junior',{kind:'redeem',tranche:'junior',shares:a.junior_shares},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,shares:a.junior_shares,lockedBackingPreserved:true};
 }));
 rows.push(await page.qa.test('policy expiry',1,async()=>{
  const op=await page.qa.execute('early-expiry-first',{kind:'expire',policyId:policy.id},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,activeCoverCannotExpireEarly:true};
 }));
 return rows.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
export async function staleQuote(page,expect){
 const quote=JSON.parse(await readFile('.ballast-private/account-tests/quote-third.json','utf8'));
 const agent=JSON.parse(await readFile('.ballast-private/account-tests/agent-third.json','utf8'));
 const row=await page.qa.test('coverage binding',3,async()=>{
  const manifest=JSON.parse(agent.manifest);manifest.scope+=' The operator reviews execution receipts daily.';
  await page.qa.execute('third-next-revision',{kind:'revise',agentId:agent.id,manifest:JSON.stringify(manifest),historyUrls:agent.history_urls,publicConsent:true});
  const before=await page.qa.account();const r=await page.qa.submit('stale-third-bind',{kind:'bind',quoteId:quote.id});expect(r.status).toBe(409);
  const after=await page.qa.account();expect(after.balance).toBe(before.balance);
  const first=JSON.parse(await readFile('.ballast-private/account-tests/claim-first_1.json','utf8'));
  const repeat=await page.qa.submit('preflight-repeat-first-bind',{kind:'bind',quoteId:first.policyId});expect(repeat.status).toBe(409);
  const self=await page.qa.submit('preflight-own-first-claim',{kind:'claim',policyId:first.policyId,incidentRef:first.incidentRef,incidentAt:first.incidentAt,amount:'0.1',statement:first.statement,evidenceUrls:first.evidenceUrls,publicConsent:true});expect(self.status).toBe(403);
  const protectedAccount=await page.qa.account();expect(protectedAccount.balance).toBe(before.balance);
  await page.qa.save('paid-preflight-proof.json',{beforeWei:before.balance,afterWei:protectedAccount.balance,staleQuoteStatus:r.status,duplicateBindStatus:repeat.status,operatorSelfClaimStatus:self.status,noPremiumOrBondSent:true});
  return {httpStatus:409,staleManifestQuoteRejected:true,noPremiumSent:true,balanceUnchanged:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
