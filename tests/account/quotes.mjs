import {readFile} from 'node:fs/promises';
export async function quote(page,expect,name,n){
 const inputs=JSON.parse(await readFile('.ballast-private/account-tests/agent-inputs.json','utf8'));
 const agent=JSON.parse(await readFile('.ballast-private/account-tests/agent-'+name+'.json','utf8'));
 const row=await page.qa.test('risk quotes',n,async()=>{
  let response;try{response=JSON.parse(await readFile('.ballast-private/account-tests/ui-quote-'+name+'.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!response){
   await page.qa.close();await page.getByRole('button',{name:'Agents & cover',exact:true}).click();
   await page.getByLabel('Record type').selectOption('agents');
   await page.getByLabel('Full record ID').fill(agent.id);await page.getByRole('button',{name:'Find record',exact:true}).click();
   await page.getByRole('dialog').getByRole('button',{name:'Request a quote',exact:true}).click();
   await page.getByLabel('Coverage limit').fill('0.1');await page.getByLabel('Peer evidence').fill(inputs[name].peerUrls.join('\n'));
   const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Request a considered quote',exact:true}).click();
   const r=await pending;response={status:r.status(),data:await r.json()};await page.qa.save('ui-quote-'+name+'.json',response);
  }
  const op=await page.qa.wait(response);expect(op.execution).toBe('success');
  let result;
  for(let i=0;i<4;i++){result=await page.qa.api('/records?kind=quotes&mine=true');if(result.status===200&&result.data.items.some(q=>q.agent_id===agent.id))break;await new Promise(r=>setTimeout(r,20000));}
  expect(result.status).toBe(200);const record=result.data.items.find(q=>q.agent_id===agent.id);expect(record).toBeTruthy();
  expect(['low','medium','high','declined']).toContain(record.band);expect(record.reason.length).toBeGreaterThan(10);
  await page.qa.save('quote-'+name+'.json',record);
  return {quoteId:record.id,band:record.band,premiumWei:record.premium,limitWei:record.limit,transaction:op.tx_hash,votes:op.votes,reason:record.reason,submittedThroughUI:true};
 });return {case:row.case,status:row.status,error:row.error,evidence:row.evidence};
}
