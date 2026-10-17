import {readFile} from 'node:fs/promises';
export async function enrich(page,expect,name){
 const actor=JSON.parse(await readFile('.ballast-private/account-tests/agent-'+name+'.json','utf8'));
 const inputs=JSON.parse(await readFile('.ballast-private/account-tests/agent-inputs.json','utf8'))[name];
 const evidence=JSON.parse(await readFile('.ballast-private/account-tests/evidence.json','utf8'));
 const current=await page.qa.api('/records?kind=agents&id='+actor.id);expect(current.status).toBe(200);
 const manifest=JSON.parse(current.data.record.manifest);
 const source='https://raw.githubusercontent.com/dotmantissa/ballast/'+evidence.historyCommit+'/docs/live-cases/registered-account-20261017/'+name+'-history.json';
 if(manifest.history_record===source){await page.qa.save('agent-'+name+'.json',current.data.record);return {alreadyRegistered:true,id:actor.id};}
 manifest.history_record=source;
 const op=await page.qa.execute('enrich-history-'+name,{kind:'revise',agentId:actor.id,manifest:JSON.stringify(manifest,null,2),historyUrls:[source,...inputs.historyUrls],publicConsent:true});
 const result=await page.qa.api('/records?kind=agents&id='+actor.id);expect(result.status).toBe(200);
 await page.qa.save('agent-'+name+'.json',result.data.record);
 return {id:actor.id,transaction:op.tx_hash,historyRecord:source};
}
