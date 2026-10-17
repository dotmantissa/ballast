export async function run(page,context,expect){
 const results=[];
 const check=async(feature,n,fn)=>results.push(await page.qa.test(feature,n,fn));
 await page.qa.close();
 await check('capital contributions',3,async()=>{
  for(const amount of ['0','-1','101']){
   const result=await page.qa.api('/actions',{method:'POST',data:{kind:'stake',tranche:'junior',amount},headers:{'Idempotency-Key':crypto.randomUUID()}});
   expect(result.status).toBe(400);
  }
  return {rejectedAmounts:['0','-1','101'],httpStatus:400,noTransactionSubmitted:true};
 });
 await check('navigation and accessibility',1,async()=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Capital pool',exact:true}).click();
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await expect(page.locator('.topbar')).toBeInViewport();
  expect(await page.locator('.topbar').evaluate(e=>e.getBoundingClientRect().top)).toBe(0);
  await expect(page.getByRole('button',{name:'Back to top',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to top',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  return {signedIn:true,stickyHeader:true,backToTop:true};
 });
 await check('navigation and accessibility',2,async()=>{
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Field guide',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Four findings, not a shrug.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await page.getByRole('button',{name:'Back to top',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  return {width:390,noHorizontalOverflow:true,mobileNavigation:true,backToTop:true};
 });
 await check('navigation and accessibility',3,async()=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  const back=page.getByRole('button',{name:'Back to top',exact:true});await back.focus();
  await expect(back).toBeFocused();expect(await back.evaluate(e=>getComputedStyle(e).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await expect(page.locator('#main')).toBeFocused();
  await page.emulateMedia({reducedMotion:'no-preference'});
  return {keyboardOperable:true,visibleFocus:true,reducedMotion:true};
 });
 await page.setViewportSize({width:1440,height:1000});
 await check('themes and account UI',1,async()=>{
  const light=page.getByRole('button',{name:'Switch to light mode',exact:true});if(await light.count())await light.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Capital pool',exact:true}).click();
  await expect(page.locator('.tranche-junior')).toContainText('0.50');
  await expect(page.locator('.tranche-senior')).toContainText('0.50');
  await page.screenshot({path:'.ballast-private/account-tests/account-capital-light.png',fullPage:true});
  return {populatedJuniorGEN:'0.5',populatedSeniorGEN:'0.5',theme:'light'};
 });
 await check('themes and account UI',2,async()=>{
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/account')&&r.status()===200,{timeout:60000});
  await page.reload();const account=await(await response).json();
  expect(account.address.toLowerCase()).toBe('0x115a0d969bbb326e1cbe628cedb21b76a8141d10');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await context.storageState({path:'.ballast-private/account-tests/session.json'});
  return {themePersisted:true,authenticationRetained:true};
 });
 await check('themes and account UI',3,async()=>{
  await page.locator('.account-button').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('0x115a0d969bBB326E1CBE628CEDb21B76A8141D10');
  const text=await dialog.innerText();expect(text).not.toMatch(/encrypted_key|privy_app_secret|postgresql:|CUSTODY_MASTER_KEY/);
  await expect(page.getByRole('button',{name:'Withdraw pool credit',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Withdraw bond credit',exact:true})).toBeDisabled();
  await page.qa.close();return {publicAddressCorrect:true,emptyWithdrawalsDisabled:true,noSecretsRendered:true};
 });
 return results.map(({feature,case:n,status,error})=>({feature,case:n,status,error}));
}
