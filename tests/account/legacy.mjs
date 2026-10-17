import {readFile} from 'node:fs/promises';
export async function run(page,expect){
 const out=[];
 out.push(await page.qa.test('earlier pool redemption',1,async()=>{
  const before=JSON.parse(await readFile('.ballast-private/account-tests/account-baseline.json','utf8'));
  const after=JSON.parse(await readFile('.ballast-private/account-tests/current-reconciliation.json','utf8'));
  const operation=after.operations.find(o=>o.id==='0d409b11-19f8-4408-bb78-cf0784dea3e1');
  expect(operation?.execution).toBe('success');expect(before.legacyCapital.junior_value).toBe('15000000000000000000');expect(after.legacyCapital.junior_value).toBe('0');
  return {transaction:operation.tx_hash,amountGEN:'15',performedBy:'account owner, confirmed by user',observedThroughAuthenticatedAccount:true};
 }));
 out.push(await page.qa.test('earlier pool redemption',2,async()=>{
  const op=await page.qa.execute('empty-earlier-junior-redemption',{kind:'redeem_legacy',tranche:'junior',shares:'1'},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,unownedSharesRejected:true};
 }));
 out.push(await page.qa.test('earlier pool redemption',3,async()=>{
  const op=await page.qa.execute('excess-earlier-senior-redemption',{kind:'redeem_legacy',tranche:'senior',shares:'100000000000000000000'},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,excessSharesRejected:true};
 }));
 out.push(await page.qa.test('earlier pool withdrawal',1,async()=>{
  const after=JSON.parse(await readFile('.ballast-private/account-tests/current-reconciliation.json','utf8'));
  const operation=after.operations.find(o=>o.id==='cf579a2f-b21c-43b5-83fd-f11229f48424');
  expect(operation?.execution).toBe('success');expect(after.balance).toBe('19125000000000000000');
  return {transaction:operation.tx_hash,nativeIncreaseWei:'15000000000000000000',performedBy:'account owner, confirmed by user'};
 }));
 out.push(await page.qa.test('earlier pool withdrawal',2,async()=>{
  await page.qa.close();await page.getByRole('button',{name:'Capital pool',exact:true}).click();
  await expect(page.getByRole('button',{name:'Withdraw earlier pool credit',exact:true})).toBeDisabled();
  return {emptyEarlierCreditDisabled:true};
 }));
 out.push(await page.qa.test('earlier pool withdrawal',3,async()=>{
  const op=await page.qa.execute('empty-earlier-credit-withdrawal',{kind:'withdraw_legacy'},'error');expect(op.error).not.toContain('did not agree');return {transaction:op.tx_hash,noRepeatPayment:true};
 }));
 return out.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
