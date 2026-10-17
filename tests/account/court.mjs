import {readFile} from 'node:fs/promises';
async function fixture(name='first',round='1'){return JSON.parse(await readFile('.ballast-private/account-tests/claim-'+name+'_'+round+'.json','utf8'));}
export async function record(page,expect,name='first',round='1'){
 const file=await fixture(name,round);let response;
 for(let i=0;i<4;i++){response=await page.qa.api('/records?kind=claims&id='+file.id);if(response.status===200)break;await new Promise(r=>setTimeout(r,20000));}
 expect(response.status).toBe(200);return response.data.record;
}
export async function show(page,expect,name='first',round='1'){
 const file=await fixture(name,round);await page.qa.close();
 await page.getByRole('button',{name:/^Claims court/}).click();
 await page.getByLabel('Record type').selectOption('claims');await page.getByLabel('Full record ID').fill(file.id);
 await page.getByRole('button',{name:'Find record',exact:true}).click();
 await expect(page.locator('.claim-detail')).toBeVisible();return file;
}
export async function filed(page,expect,name='first',round='1'){
 const row=await page.qa.test('claim filing',1,async()=>{
  const c=await record(page,expect,name,round);const file=await fixture(name,round);
  expect(c.operator.toLowerCase()).toBe('0x115a0d969bbb326e1cbe628cedb21b76a8141d10');expect(c.claimant.toLowerCase()).not.toBe(c.operator.toLowerCase());
  expect(c.incident_ref).toBe(file.incidentRef);expect(c.incident_at).toBe(file.incidentAt);expect(c.amount).toBe('100000000000000000');
  await page.qa.save('filed-'+name+'-'+round+'.json',c);return {claimId:c.id,policyId:c.policy_id,incidentRef:c.incident_ref,filedBy:'separate controlled claimant',observedBy:'authenticated registered operator'};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function operatorRefusal(page,expect){
 const file=await fixture();const row=await page.qa.test('claim filing',3,async()=>{
  const op=await page.qa.execute('operator-self-claim',{kind:'claim',policyId:file.policyId,incidentRef:file.incidentRef,incidentAt:file.incidentAt,amount:'0.1',statement:file.statement,evidenceUrls:file.evidenceUrls,publicConsent:true},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,operatorSelfClaimRejected:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function evidence(page,expect){
 const file=await fixture();const actor=JSON.parse(await readFile('.ballast-private/account-tests/actors-public.json','utf8'));const published=JSON.parse(await readFile('.ballast-private/account-tests/evidence.json','utf8'));
 const sources=['https://raw.githubusercontent.com/dotmantissa/ballast/'+published.historyCommit+'/docs/live-cases/registered-account-20261017/first-history.json','https://explorer-studio.genlayer.com/api/transactions/'+actor.checks.first_approve.hash];
 const rows=[];
 rows.push(await page.qa.test('additional evidence',1,async()=>{
  const op=await page.qa.execute('first-corroborating-evidence',{kind:'evidence',claimId:file.id,evidenceUrls:sources,publicConsent:true});
  const claim=await record(page,expect);for(const source of sources)expect(claim.effective_evidence_urls).toContain(source);
  return {transaction:op.tx_hash,acceptedSources:sources};
 }));
 rows.push(await page.qa.test('additional evidence',2,async()=>{
  const r=await page.qa.api('/actions',{method:'POST',data:{kind:'evidence',claimId:file.id,evidenceUrls:['https://example.com/a','https://example.com:443/b'],publicConsent:true},headers:{'Idempotency-Key':crypto.randomUUID()}});
  expect(r.status).toBe(400);return {sameHostAliasesRejected:true,httpStatus:400};
 }));
 rows.push(await page.qa.test('additional evidence',3,async()=>{
  const r=await page.qa.api('/actions',{method:'POST',data:{kind:'evidence',claimId:file.id,evidenceUrls:['https://[invalid',sources[0]],publicConsent:true},headers:{'Idempotency-Key':crypto.randomUUID()}});
  expect(r.status).toBe(400);return {malformedSourceRejected:true,httpStatus:400};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function findings(page,expect){
 const file=await fixture();const policy=JSON.parse(await readFile('.ballast-private/account-tests/policy-first.json','utf8'));
 const ready=async fields=>{
  for(let i=0;i<90;i++){
   const c=await record(page,expect);await page.qa.save('first-case-progress.json',c);
   if(fields.every(f=>Object.hasOwn(c.findings,f)))return c;
   await new Promise(r=>setTimeout(r,20000));
  }
  throw Error('Real validator findings are still pending; resume the saved case');
 };
 const rows=[];
 rows.push(await page.qa.test('four findings',1,async()=>{
  const c=await ready(['harm']);expect(c.findings.harm).toBe(true);expect(c.verified_loss).toBe('200000000000000000');expect(c.verified_incident_at).toBe(file.incidentAt);
  expect(c.verified_incident_at).toBeGreaterThanOrEqual(policy.starts_at);expect(c.verified_incident_at).toBeLessThanOrEqual(policy.ends_at);
  return {claimId:c.id,harm:c.findings.harm,verifiedLoss:c.verified_loss,actualEventTimeVerified:true};
 }));
 rows.push(await page.qa.test('four findings',2,async()=>{
  const c=await ready(['causation','scope']);expect(c.findings.causation).toBe(true);expect(c.findings.scope).toBe(false);return {claimId:c.id,causation:c.findings.causation,withinScope:c.findings.scope};
 }));
 rows.push(await page.qa.test('four findings',3,async()=>{
  const c=await ready(['harm','causation','scope','payout']);expect([0,25,50,75,100]).toContain(c.findings.payout);expect(c.status).toBe('challenge');
  await show(page,expect);await expect(page.locator('.finding-entry.resolved')).toHaveCount(4);await page.qa.save('first-case-findings.json',c);
  return {claimId:c.id,findings:c.findings,allFourRendered:true,realValidatorJudgments:true};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
const reason='Please independently reconsider the declared scope against the actual approval rule and finalized debit. This controlled vault test demonstrates an unapproved spend. The parties are exercising separate challenge rights; this request does not allege any new loss or repayment.';
export async function operatorAppeal(page,expect){
 const file=await fixture();const row=await page.qa.test('scoped appeals',1,async()=>{
  const op=await page.qa.execute('first-operator-scope-appeal',{kind:'appeal',claimId:file.id,finding:'scope',reason,evidenceUrls:file.evidenceUrls,publicConsent:true});
  const c=await record(page,expect);expect(c.appeals.some(a=>a.field==='scope'&&a.by.toLowerCase()===c.operator.toLowerCase())).toBe(true);
  await page.qa.save('first-after-operator-appeal.json',c);return {transaction:op.tx_hash,claimId:c.id,actualAppeal:c.appeals.at(-1)};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function appealRights(page,expect){
 const file=await fixture();const rows=[];
 rows.push(await page.qa.test('scoped appeals',2,async()=>{
  const c=await record(page,expect);expect(c.appeals.filter(a=>a.field==='scope')).toHaveLength(2);
  expect(new Set(c.appeals.filter(a=>a.field==='scope').map(a=>a.by.toLowerCase())).size).toBe(2);
  await page.qa.save('first-both-appeals.json',c);return {claimId:c.id,bothPartiesAppealedSameFinding:true,appeals:c.appeals};
 }));
 rows.push(await page.qa.test('scoped appeals',3,async()=>{
  const op=await page.qa.execute('first-repeat-operator-scope-appeal',{kind:'appeal',claimId:file.id,finding:'scope',reason,evidenceUrls:file.evidenceUrls,publicConsent:true},'error');
  expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,repeatPartyAppealRejected:true};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function earlyGuards(page,expect){
 const file=await fixture();
  const row=await page.qa.test('claim recovery',3,async()=>{
   const c=await record(page,expect);expect(c.review_deadline).toBeGreaterThan(Math.floor(Date.now()/1000));
   const op=await page.qa.execute('first-early-review-timeout',{kind:'close_unresolved',claimId:file.id},'error');expect(op.error).not.toContain('did not agree');
   return {transaction:op.tx_hash,reviewDeadline:c.review_deadline,earlyClosureRejected:true};
  });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function accept(page,expect){
 const file=await fixture();const row=await page.qa.test('decision and settlement',1,async()=>{
  await page.qa.execute('first-operator-accept',{kind:'accept_decision',claimId:file.id});const c=await record(page,expect);
  expect(new Set(c.acceptances.map(a=>a.toLowerCase()))).toEqual(new Set([c.claimant.toLowerCase(),c.operator.toLowerCase()]));
  return {claimId:c.id,bothPartiesAccepted:true,acceptances:c.acceptances};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function finalize(page,expect){
 const file=await fixture();const row=await page.qa.test('decision and settlement',2,async()=>{
  const op=await page.qa.execute('first-finalize',{kind:'finalize',claimId:file.id});const c=await record(page,expect);expect(c.status).toBe('final');expect(c.outcome).toBe('adjudicated');
  await page.qa.save('first-final-decision.json',c);return {transaction:op.tx_hash,claimId:c.id,payoutWei:c.payout,mutualAcceptanceRespected:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function settle(page,expect){
 const file=await fixture();const row=await page.qa.test('decision and settlement',3,async()=>{
  const audit=JSON.parse(await readFile('.ballast-private/account-tests/audit-first_1.json','utf8'));expect(audit.finalClaim.id).toBe(file.id);expect(audit.finalClaim.status).toBe('final');
  const op=await page.qa.execute('first-settle',{kind:'settle',claimId:file.id});let c;
  for(let i=0;i<30;i++){c=await record(page,expect);if(c.status==='settled')break;await new Promise(r=>setTimeout(r,12000));}
  expect(c.status).toBe('settled');expect(BigInt(c.settled_payout)).toBeLessThanOrEqual(BigInt(c.verified_loss));
  await page.qa.save('first-settled.json',c);return {transaction:op.tx_hash,claimId:c.id,paidWei:c.settled_payout,authenticatedFinalDecisionObserved:true,settlementAcknowledged:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function closure(page,expect){
 const file=await fixture();const rows=[];
 rows.push(await page.qa.test('claim recovery',1,async()=>{
  const before=await record(page,expect);const op=await page.qa.execute('first-republish-final-claim',{kind:'publish_confirmation',target:'claim',recordId:file.id});const after=await record(page,expect);
  expect(after.findings).toEqual(before.findings);expect(after.payout).toBe(before.payout);return {transaction:op.tx_hash,decisionUnchanged:true};
 }));
 rows.push(await page.qa.test('bond withdrawal',1,async()=>{
  const a=await page.qa.account('before-operator-bond-withdrawal');expect(BigInt(a.bondCredit)).toBeGreaterThan(0n);return {actualBondCreditWei:a.bondCredit};
 }));
 rows.push(await page.qa.test('bond withdrawal',2,async()=>{
  const before=await page.qa.account();const op=await page.qa.execute('first-operator-bond-withdrawal',{kind:'withdraw_bonds'});const after=await page.qa.account('after-operator-bond-withdrawal');
  expect(after.bondCredit).toBe('0');expect(BigInt(after.balance)-BigInt(before.balance)).toBe(BigInt(before.bondCredit));
  return {transaction:op.tx_hash,withdrawnWei:before.bondCredit,exactNativeIncrease:true};
 }));
 rows.push(await page.qa.test('bond withdrawal',3,async()=>{
  const op=await page.qa.execute('first-empty-operator-bond-withdrawal',{kind:'withdraw_bonds'},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,noDoublePayment:true};
 }));
 return rows.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
export async function history(page,expect){
 const file=await fixture();const rows=[];
 rows.push(await page.qa.test('loss history',1,async()=>{
  const op=await page.qa.execute('first-sync-loss',{kind:'sync_loss',claimId:file.id});return {transaction:op.tx_hash,claimId:file.id};
 }));
 rows.push(await page.qa.test('loss history',2,async()=>{
  const op=await page.qa.execute('first-repeat-sync-loss',{kind:'sync_loss',claimId:file.id},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,duplicateSyncRejected:true};
 }));
 rows.push(await page.qa.test('loss history',3,async()=>{
  const audit=JSON.parse(await readFile('.ballast-private/account-tests/audit-first_1.json','utf8'));const c=await record(page,expect);
  expect(audit.lossRecord.paid).toBe(c.settled_payout);expect(audit.finalSettlement.paid).toBe(c.settled_payout);
  return {paidWei:c.settled_payout,lossRecord:audit.lossRecord,actualFinalizedAccounting:true};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
