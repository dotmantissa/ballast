/** Opt in live account console. All transactions use the authenticated application relay. */
import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile,chmod,cp} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {install} from '../tests/account/harness.mjs';

if(process.env.BALLAST_LIVE_ACCOUNT_TEST!=='1')throw Error('Set BALLAST_LIVE_ACCOUNT_TEST=1 only for an authorized live account journey');
const email=process.env.BALLAST_ACCOUNT_EMAIL;
const address=process.env.BALLAST_ACCOUNT_ADDRESS;
if(!email||!/^0x[a-f0-9]{40}$/i.test(address??''))throw Error('Supply the authorized account email and public Studio address');
process.umask(0o077);
const folder='.ballast-private/account-tests';await mkdir(folder,{recursive:true,mode:0o700});
const session=folder+'/session.json';
let storageState;try{await readFile(session);storageState=session;}catch(error){if(error.code!=='ENOENT')throw error;}
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({...(storageState?{storageState}:{}),viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('request',request=>{
 const url=new URL(request.url());
 if(url.origin==='https://ballast-cover.vercel.app'&&url.pathname.startsWith('/api/')){
  const authorization=request.headers().authorization;if(authorization)page.qaAuthorization=authorization;
 }
});
const input=createInterface({input:process.stdin,output:process.stdout,terminal:false});
async function checkpoint(){
 await context.storageState({path:session});await chmod(session,0o600);
 await cp(folder,'.git/ballast-account-tests-backup',{recursive:true,force:true});
}
try{
 await page.goto('https://ballast-cover.vercel.app/');
 await expect.poll(async()=>await page.locator('.account-button').count()===1||await page.getByRole('button',{name:'Sign in with email',exact:true}).isEnabled().catch(()=>false),{timeout:60000}).toBe(true);
 if(await page.locator('.account-button').count()===0){
  await page.getByRole('button',{name:'Sign in with email',exact:true}).click();
  await page.locator('input[type=email]').fill(email);
  await page.getByRole('dialog').getByRole('button',{name:'Submit',exact:true}).click();
  await page.locator('input[name=code-0]').waitFor();
  const code=(await input.question('Enter the confirmation code from your email: ')).trim();
  if(!/^\d{6}$/.test(code))throw Error('A six digit email code is required');
  await page.locator('input[name=code-0]').fill(code);
 }
 await expect(page.locator('.account-button')).toContainText('GEN',{timeout:90000});
 let matrix;try{matrix=JSON.parse(await readFile(folder+'/matrix.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;matrix={baseURL:'https://ballast-cover.vercel.app',scenarios:[]};}
 for(const scenario of JSON.parse(await readFile('tests/account/scenarios.json','utf8'))){if(!matrix.scenarios.some(row=>row.feature===scenario.feature&&row.case===scenario.case))matrix.scenarios.push({...scenario,status:'pending'});}
 await writeFile(folder+'/matrix.json',JSON.stringify(matrix,null,2)+'\n',{mode:0o600});
 await install(page,context,expect);
 const account=await page.qa.account();expect(account.email.toLowerCase()).toBe(email.toLowerCase());expect(account.address.toLowerCase()).toBe(address.toLowerCase());
 try{await writeFile(folder+'/account-baseline.json',JSON.stringify(account,null,2)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 await checkpoint();
 console.log(JSON.stringify({status:'ready',address:account.address,scenarios:matrix.scenarios.length}));
 for(;;){
  const line=await input.question('Account test command: ');const command=JSON.parse(line);
  if(command.action==='exit')break;
  try{
   let result;
   switch(command.action){
    case 'readOnly':result=await(await import('../tests/account/read-only.mjs')).run(page,context,expect);break;
    case 'register':result=await(await import('../tests/account/registry.mjs')).register(page,expect,command.executor,command.case);break;
    case 'quote':result=await(await import('../tests/account/quotes.mjs')).quote(page,expect,command.executor,command.case);break;
    case 'enrich':result=await(await import('../tests/account/enrich-history.mjs')).enrich(page,expect,command.executor);break;
    case 'guards':result=await(await import('../tests/account/guards.mjs')).roleProofs(page,expect);break;
    case 'excessRedemption':result=await(await import('../tests/account/guards.mjs')).excessRedemption(page,expect);break;
    case 'bind':result=await(await import('../tests/account/coverage.mjs')).bind(page,expect,command.executor,command.case);break;
    case 'activeGuards':result=await(await import('../tests/account/coverage.mjs')).activeGuards(page,expect);break;
    case 'staleQuote':result=await(await import('../tests/account/coverage.mjs')).staleQuote(page,expect);break;
    case 'legacy':result=await(await import('../tests/account/legacy.mjs')).run(page,expect);break;
    case 'funding':result=await(await import('../tests/account/account-records.mjs')).funding(page,expect);break;
    case 'records':result=await(await import('../tests/account/account-records.mjs')).records(page,expect);break;
    case 'activity':result=await(await import('../tests/account/account-records.mjs')).activity(page,expect);break;
    case 'caseEvidence':{const court=await import('../tests/account/court.mjs');result={filed:await court.filed(page,expect),evidence:await court.evidence(page,expect),selfClaim:await court.operatorRefusal(page,expect)};break;}
    case 'findings':result=await(await import('../tests/account/court.mjs')).findings(page,expect);break;
    case 'earlyRecovery':result=await(await import('../tests/account/court.mjs')).earlyGuards(page,expect);break;
    case 'operatorAppeal':result=await(await import('../tests/account/court.mjs')).operatorAppeal(page,expect);break;
    case 'appealRights':result=await(await import('../tests/account/court.mjs')).appealRights(page,expect);break;
    case 'accept':result=await(await import('../tests/account/court.mjs')).accept(page,expect);break;
    case 'finalize':result=await(await import('../tests/account/court.mjs')).finalize(page,expect);break;
    case 'settle':result=await(await import('../tests/account/court.mjs')).settle(page,expect);break;
    case 'closure':result=await(await import('../tests/account/court.mjs')).closure(page,expect);break;
    case 'history':result=await(await import('../tests/account/court.mjs')).history(page,expect);break;
    default:throw Error('Choose a named account test action');
   }
   await checkpoint();
   console.log(JSON.stringify({ok:true,result}));
  }catch(error){console.log(JSON.stringify({ok:false,error:String(error).replace(/Bearer\s+[^\s'\"]+/gi,'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted session]').slice(0,1200)}));}
 }
}finally{input.close();await browser.close();}
