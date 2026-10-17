import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function register(page,expect,name,n){
 const inputs=JSON.parse(await readFile('.ballast-private/account-tests/agent-inputs.json','utf8'));
 const input=inputs[name];if(!input)throw Error('This executor history is not finalized yet');
 await page.qa.close();await page.getByRole('button',{name:'Agents & cover',exact:true}).click();
 const row=await page.qa.test('agent registration',n,async()=>{
  let response;
  try {response=JSON.parse(await readFile('.ballast-private/account-tests/ui-register-'+name+'.json','utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!response){
   await page.getByRole('button',{name:'Register an agent',exact:true}).first().click();
   await page.getByLabel('Capability manifest').fill(input.manifest);
   await page.getByLabel('Public action history').fill(input.historyUrls.join('\n'));
   await page.getByRole('checkbox').check();
   const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Register manifest',exact:true}).click();
   const r=await pending;response={status:r.status(),data:await r.json()};
   await page.qa.save('ui-register-'+name+'.json',response);
  }
  const op=await page.qa.wait(response);expect(op.execution).toBe('success');
  const id=createHash('sha256').update('genlayer-studio:'+input.address.toLowerCase()).digest('hex').slice(0,24);
  const record=await page.qa.api('/records?kind=agents&id='+id);expect(record.status).toBe(200);
  expect(record.data.record.operator.toLowerCase()).toBe('0x115a0d969bbb326e1cbe628cedb21b76a8141d10');
  expect(record.data.record.executor_address.toLowerCase()).toBe(input.address.toLowerCase());
  await page.qa.save('agent-'+name+'.json',record.data.record);
  return {agentId:id,executor:input.address,transaction:op.tx_hash,submittedThroughUI:true,actualHistory:true};
 });
 return {feature:row.feature,case:row.case,status:row.status,error:row.error,evidence:row.evidence};
}
