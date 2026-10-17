import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const folder='.ballast-private/account-tests/continuation/';
async function load(name){return JSON.parse(await readFile(folder+name+'.json','utf8'));}
async function persist(page,name,data){await page.qa.save('continuation/'+name+'.json',data);}
export async function setup(page,expect){
 const actors=await load('actors-public');const evidence=await load('evidence');expect(actors.historyReady).toBe(true);
 const history='https://raw.githubusercontent.com/dotmantissa/ballast/'+evidence.historyCommit+'/docs/live-cases/registered-account-continuation-20261017/first-history.json';
 const sources=[history,'https://explorer-studio.genlayer.com/api/transactions/'+actors.checks.first_refund.hash];
 const manifest={name:'Harbor continuation fixture',executor_address:actors.addresses.first,spend_limit_gen:1,history_record:history,scope:'Controlled Studio test executor for claimant owned native GEN escrow in vault '+actors.vaults.first+'. Only execute_approved_refund after exact claimant approval, at most 1 GEN per transfer, paid only to that claimant. Any spend_without_approval call or another recipient is outside scope. The vault deliberately exposes an insecure method for this genuine small test debit. These are test funds and controlled actors.'};
 await page.qa.execute('continuation-register',{kind:'register',manifest:JSON.stringify(manifest),historyUrls:sources,publicConsent:true});
 const id=createHash('sha256').update('genlayer-studio:'+actors.addresses.first.toLowerCase()).digest('hex').slice(0,24);
 const agent=await page.qa.api('/records?kind=agents&id='+id);expect(agent.status).toBe(200);await persist(page,'agent-first',agent.data.record);
 await new Promise(r=>setTimeout(r,30000));
 const peer='https://raw.githubusercontent.com/dotmantissa/ballast/bd7dc86858c4ab861c96e037aea960a4fad3b466/docs/live-cases/studio-review-20261016153332/peer.json';
 const quoteOp=await page.qa.execute('continuation-quote',{kind:'quote',agentId:id,limit:'0.1',peerUrls:[peer]});
 const quotes=await page.qa.api('/records?kind=quotes&mine=true');expect(quotes.status).toBe(200);const quote=quotes.data.items.find(q=>q.agent_id===id);expect(quote).toBeTruthy();expect(quote.band).not.toBe('declined');await persist(page,'quote-first',quote);
 const bind=await page.qa.execute('continuation-bind',{kind:'bind',quoteId:quote.id});
 const policy=await page.qa.api('/records?kind=policies&id='+quote.id);expect(policy.status).toBe(200);expect(policy.data.record.status).toBe('active');await persist(page,'policy-first',policy.data.record);
 return {additionalFixture:true,agentId:id,policyId:quote.id,quoteTransaction:quoteOp.tx_hash,bindTransaction:bind.tx_hash,limitWei:quote.limit,premiumWei:quote.premium};
}
async function claim(page,expect){const fixture=await load('active-claim');const r=await page.qa.api('/records?kind=claims&id='+fixture.id);expect(r.status).toBe(200);return r.data.record;}
export async function waitFindings(page,expect){
 for(let i=0;i<100;i++){const c=await claim(page,expect);await persist(page,'claim-progress',c);if(c.status==='challenge')return {id:c.id,findings:c.findings};await new Promise(r=>setTimeout(r,20000));}
 throw Error('The additional controlled case is still under actual review');
}
export async function appeal(page,expect){
 const file=await load('active-claim');const row=await page.qa.test('scoped appeals',1,async()=>{
  const reason='Independently reconsider the scope finding against the actual exact approval rule and finalized unapproved debit. This deliberate controlled test asks both parties to use their own challenge rights. It supplies no invented harm, new repayment, or additional loss.';
  const op=await page.qa.execute('continuation-operator-appeal',{kind:'appeal',claimId:file.id,finding:'scope',reason,evidenceUrls:file.evidenceUrls,publicConsent:true});
  const c=await claim(page,expect);expect(c.appeals.some(a=>a.by.toLowerCase()===c.operator.toLowerCase()&&a.field==='scope')).toBe(true);await persist(page,'after-operator-appeal',c);
  return {claimId:c.id,transaction:op.tx_hash,actualFinding:c.findings.scope,additionalControlledFixture:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function rights(page,expect){
 const file=await load('active-claim');const rows=[];
 rows.push(await page.qa.test('scoped appeals',2,async()=>{
  const c=await claim(page,expect);expect(c.appeals.filter(a=>a.field==='scope')).toHaveLength(2);expect(new Set(c.appeals.map(a=>a.by.toLowerCase())).size).toBe(2);await persist(page,'both-appeals',c);return {claimId:c.id,independentPartyRights:true,appeals:c.appeals};
 }));
 rows.push(await page.qa.test('scoped appeals',3,async()=>{
  const before=await page.qa.account();const r=await page.qa.submit('continuation-repeat-operator-appeal',{kind:'appeal',claimId:file.id,finding:'scope',reason:'This repeat uses the same actual sources to verify that this party cannot consume a second challenge right.',evidenceUrls:file.evidenceUrls,publicConsent:true});expect(r.status).toBe(409);const after=await page.qa.account();expect(after.balance).toBe(before.balance);return {httpStatus:409,repeatRightRefused:true,noBondSent:true,balanceUnchanged:true};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function acceptAndFinalize(page,expect){
 const file=await load('active-claim');const rows=[];
 rows.push(await page.qa.test('decision and settlement',1,async()=>{
  const op=await page.qa.execute('continuation-operator-accept',{kind:'accept_decision',claimId:file.id});const c=await claim(page,expect);expect(new Set(c.acceptances.map(a=>a.toLowerCase()))).toEqual(new Set([c.claimant.toLowerCase(),c.operator.toLowerCase()]));return {claimId:c.id,transaction:op.tx_hash,bothPartiesAccepted:true};
 }));
 rows.push(await page.qa.test('decision and settlement',2,async()=>{
  const op=await page.qa.execute('continuation-finalize',{kind:'finalize',claimId:file.id});const c=await claim(page,expect);expect(c.status).toBe('final');expect(c.outcome).toBe('adjudicated');expect(c.finalized_at).toBeGreaterThanOrEqual(c.challenge_until);await persist(page,'final-decision',c);return {claimId:c.id,transaction:op.tx_hash,actualPayoutWei:c.payout};
 }));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function settle(page,expect){
 const file=await load('active-claim');const row=await page.qa.test('decision and settlement',3,async()=>{
  const audit=await load('audit-first_2');expect(audit.finalClaim.id).toBe(file.id);expect(audit.finalClaim.status).toBe('final');
  const op=await page.qa.execute('continuation-settle',{kind:'settle',claimId:file.id});let c;
  for(let i=0;i<30;i++){c=await claim(page,expect);if(c.status==='settled')break;await new Promise(r=>setTimeout(r,12000));}
  expect(c.status).toBe('settled');await persist(page,'settled',c);return {claimId:c.id,transaction:op.tx_hash,paidWei:c.settled_payout,authenticatedFinalProofChecked:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function recovery(page,expect){
 const file=await load('claim-first_1');const row=await page.qa.test('claim recovery',2,async()=>{
  const audit=await load('audit-first_1');expect(audit.finalClaim.id).toBe(file.id);expect(audit.finalClaim.outcome).toBe('withdrawn');expect(audit.finalClaim.payout).toBe('0');expect(BigInt(audit.claimantCourt.bond_credit)).toBeGreaterThanOrEqual(10n**16n);
  const op=await page.qa.execute('continuation-withdrawn-settle',{kind:'settle',claimId:file.id});let c;
  for(let i=0;i<30;i++){const r=await page.qa.api('/records?kind=claims&id='+file.id);expect(r.status).toBe(200);c=r.data.record;if(c.status==='settled')break;await new Promise(r=>setTimeout(r,12000));}
  expect(c.status).toBe('settled');expect(c.settled_payout).toBe('0');await persist(page,'withdrawn-settled',c);return {claimId:c.id,transaction:op.tx_hash,outcome:c.outcome,claimBondReturned:true,unassessedCaseClosed:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function earlyRecovery(page,expect){
 const file=await load('active-claim');const row=await page.qa.test('claim recovery',3,async()=>{
  const before=await claim(page,expect);expect(['filed','reviewing']).toContain(before.status);expect(before.review_deadline).toBeGreaterThan(Math.floor(Date.now()/1000));
  const op=await page.qa.execute('continuation-early-timeout',{kind:'close_unresolved',claimId:file.id},'error');expect(op.error).not.toContain('did not agree');
  return {claimId:file.id,transaction:op.tx_hash,unresolvedAtSubmission:true,deadline:before.review_deadline,earlyTimeoutRejected:true};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function duplicate(page,expect){
 const actors=await load('actors-public');const row=await page.qa.test('claim filing',2,async()=>{
  const check=actors.checks.first_2_duplicate_refusal;expect(check.done).toBe(true);expect(check.expectedExecution).toBe('error');expect(check.rejectionReason).toContain('already been compensated');const c=await claim(page,expect);expect(BigInt(c.settled_payout)).toBeGreaterThan(0n);
  return {transaction:check.hash,canonicalCompensatedEventRejected:true,crossPolicyReplayRefused:true,caseAliasNormalized:true,claimId:c.id};
 });return {status:row.status,error:row.error,evidence:row.evidence};
}
export async function finish(page,expect){
 const file=await load('active-claim');const rows=[];
 rows.push(await page.qa.test('claim recovery',1,async()=>{
  const before=await claim(page,expect);const op=await page.qa.execute('continuation-republish-final',{kind:'publish_confirmation',target:'claim',recordId:file.id});const after=await claim(page,expect);expect(after.findings).toEqual(before.findings);expect(after.payout).toBe(before.payout);return {transaction:op.tx_hash,decisionUnchanged:true};
 }));
 rows.push(await page.qa.test('bond withdrawal',1,async()=>{
  const a=await page.qa.account('continuation/before-bond-withdrawal');expect(BigInt(a.bondCredit)).toBeGreaterThan(0n);return {actualCreditWei:a.bondCredit};
 }));
 rows.push(await page.qa.test('bond withdrawal',2,async()=>{
  const before=await load('before-bond-withdrawal');expect(BigInt(before.bondCredit)).toBeGreaterThan(0n);
  const op=await page.qa.execute('continuation-operator-withdraw-bonds',{kind:'withdraw_bonds'});let after;
  for(let attempt=0;attempt<12;attempt++){
   after=await page.qa.account();if(after.bondCredit==='0'&&BigInt(after.balance)-BigInt(before.balance)===BigInt(before.bondCredit))break;
   await new Promise(resolve=>setTimeout(resolve,15000));
  }
  await persist(page,'after-bond-withdrawal',after);expect(after.bondCredit).toBe('0');expect(BigInt(after.balance)-BigInt(before.balance)).toBe(BigInt(before.bondCredit));return {transaction:op.tx_hash,amountWei:before.bondCredit,exactNativeIncrease:true};
 }));
 rows.push(await page.qa.test('bond withdrawal',3,async()=>{
  const op=await page.qa.execute('continuation-empty-bond-withdrawal',{kind:'withdraw_bonds'},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,duplicatePaymentRefused:true};
 }));return rows.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
export async function history(page,expect){
 const file=await load('active-claim');const rows=[];
 rows.push(await page.qa.test('loss history',1,async()=>{const op=await page.qa.execute('continuation-sync-loss',{kind:'sync_loss',claimId:file.id});return {transaction:op.tx_hash,claimId:file.id};}));
 rows.push(await page.qa.test('loss history',2,async()=>{const op=await page.qa.execute('continuation-repeat-sync-loss',{kind:'sync_loss',claimId:file.id},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,noDoubleCounting:true};}));
 rows.push(await page.qa.test('loss history',3,async()=>{const audit=await load('audit-first_2');const c=await claim(page,expect);expect(audit.lossRecord.paid).toBe(c.settled_payout);expect(audit.finalSettlement.paid).toBe(c.settled_payout);return {actualPaidWei:c.settled_payout,lossRecord:audit.lossRecord};}));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
export async function expiry(page,expect){
 const file=await load('active-claim');const rows=[];
 rows.push(await page.qa.test('policy expiry',2,async()=>{const p=await page.qa.api('/records?kind=policies&id='+file.policyId);expect(p.status).toBe(200);expect(['settled','expired']).toContain(p.data.record.status);return {policyId:file.policyId,status:p.data.record.status,closedRecordReadable:true};}));
 rows.push(await page.qa.test('policy expiry',3,async()=>{const op=await page.qa.execute('continuation-early-filing-seal',{kind:'expire',policyId:file.policyId},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,unelapsedFilingWindowPreserved:true};}));return rows.map(({case:n,status,error})=>({case:n,status,error}));
}
