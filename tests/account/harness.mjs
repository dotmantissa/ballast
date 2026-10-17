import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
const root='.ballast-private/account-tests/';
export async function install(page,context,expect){
 const matrix=JSON.parse(await readFile(root+'matrix.json','utf8'));
 let journal={};try{journal=JSON.parse(await readFile(root+'actions.json','utf8'));}catch{}
 async function save(file,data){
  await mkdir(dirname(root+file),{recursive:true,mode:0o700});
  const content=JSON.stringify(data,null,2)+'\n';
  await writeFile(root+file+'.tmp',content,{mode:0o600});await rename(root+file+'.tmp',root+file);
  const backup='.git/ballast-account-tests-backup/';await mkdir(dirname(backup+file),{recursive:true,mode:0o700});
  await writeFile(backup+file+'.tmp',content,{mode:0o600});await rename(backup+file+'.tmp',backup+file);
 }
 async function api(path,options={}){
  if(!page.qaAuthorization)throw Error('No actual authenticated browser session');
  if(!/^\/[a-z]/i.test(path)||path.includes('://'))throw Error('Only local Ballast API paths may receive this session');
  if(!path.startsWith('/api/'))path='/api'+path;
  const response=await context.request.fetch('https://ballast-cover.vercel.app'+path,{...options,headers:{Authorization:page.qaAuthorization,...options.headers},timeout:90000});
  return {status:response.status(),data:await response.json()};
 }
 async function submit(name,action){
  const body=JSON.stringify(action);
  if(journal[name]&&journal[name].body!==body)throw Error('A saved test action cannot change');
  const record=journal[name]??={body,key:randomUUID(),createdAt:new Date().toISOString()};
  await save('actions.json',journal);
  if(record.response)return record.response;
  const response=await api('/actions',{method:'POST',data:action,headers:{'Idempotency-Key':record.key}});
  record.response=response;await save('actions.json',journal);return response;
 }
 async function wait(response){
  expect(response.status).toBe(202);let op=response.data;
  for(let i=0;i<75;i++){
   if(['FINALIZED','CANCELED','error'].includes(op.status))return op;
   await new Promise(r=>setTimeout(r,12000));const result=await api('/operations/'+op.id);expect(result.status).toBe(200);op=result.data;
  }
  throw Error('Finality still pending; resume the saved operation '+op.id);
 }
 async function execute(name,action,execution='success'){
  const response=await submit(name,action);const op=await wait(response);journal[name].final=op;await save('actions.json',journal);expect(op.status).toBe('FINALIZED');expect(op.execution).toBe(execution);return op;
 }
 async function retry(name){
  const record=journal[name];if(!record?.response?.data?.id)throw Error('No saved operation to reconcile');
  const checked=await api('/operations/'+record.response.data.id+'?verify=true');
  const op=checked.data;
  if(checked.status!==200||!(['FINALIZED','CANCELED'].includes(op.status))||!op.retryable||op.execution==='success')throw Error('A retry requires a confirmed terminal failure');
  const delay=Math.max(0,Date.parse(op.next_retry_at??'')-Date.now());if(delay>0)await new Promise(r=>setTimeout(r,delay));
  record.attemptHistory??=[];record.attemptHistory.push(op);
  delete record.final;delete record.response;await save('actions.json',journal);
  return submit(name,JSON.parse(record.body));
 }
 async function test(feature,n,fn){
  const row=matrix.scenarios.find(x=>x.feature===feature&&x.case===n);if(!row)throw Error('Unknown scenario '+feature+':'+n);
  if(row.status==='passed')return row;
  if(row.error){row.harnessRecoveryHistory??=[];row.harnessRecoveryHistory.push(row.error);delete row.error;}
  row.status='running';row.startedAt=new Date().toISOString();await save('matrix.json',matrix);
  try{const evidence=await fn();row.status='passed';row.evidence=evidence??{};}
  catch(error){row.status='failed';row.error=String(error).replace(/Bearer\s+[^\s'\"]+/gi,'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted session]').slice(0,1200);}
  row.completedAt=new Date().toISOString();await save('matrix.json',matrix);return row;
 }
 async function account(name){const result=await api('/account');expect(result.status).toBe(200);if(name)await save(name+'.json',result.data);return result.data;}
 async function close(){const button=page.getByRole('button',{name:'Close dialog',exact:true});if(await button.count())await button.click();const tray=page.locator('.activity-toggle[aria-expanded=true]');if(await tray.count())await tray.click();}
 if(!page.qaLoggingInstalled){
  await page.route('https://ballast-cover.vercel.app/api/actions',async route=>{
   const request=route.request();const key=request.headers()['idempotency-key'];
   if(request.method()==='POST'&&/^[a-f0-9-]{36}$/i.test(key??'')){
    await save('browser-request-'+key+'.json',{key,action:request.postDataJSON(),startedAt:new Date().toISOString()});
   }
   await route.continue();
  });
  page.on('response',async response=>{
   try{
    if(response.url()!=='https://ballast-cover.vercel.app/api/actions'||response.request().method()!=='POST')return;
    const key=response.request().headers()['idempotency-key'];if(!/^[a-f0-9-]{36}$/i.test(key??''))return;
    await save('browser-response-'+key+'.json',{key,status:response.status(),operation:await response.json()});
   }catch{/* The exact original request is already saved before transmission. */}
  });
  page.qaLoggingInstalled=true;
 }
 page.qa={api,submit,execute,wait,retry,test,account,close,journal,matrix,save};
 return {scenarios:matrix.scenarios.length,authenticated:true};
}
