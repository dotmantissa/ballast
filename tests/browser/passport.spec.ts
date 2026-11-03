import {test,expect} from './fixtures';
test('versioned APIs validate inputs and keep monitoring private',async({request})=>{
  expect((await request.get('/api/v2/agents/not-an-id/passport')).status()).toBe(400);
  expect((await request.get('/api/v2/agents/'+'a'.repeat(24)+'/passport?deployment=unlisted')).status()).toBe(400);
  expect((await request.get('/api/v2/monitoring?agentId='+'a'.repeat(24))).status()).toBe(401);
  expect((await request.get('/api/internal/dispatch')).status()).toBe(401);
});
test('public passport uses real chain records and fits a mobile viewport',async({page,request})=>{
  const overview=await (await request.get('/api/overview')).json();
  const id=process.env.BALLAST_PASSPORT_AGENT??overview.agents?.[0]?.id;
  test.skip(!id,'No real agent is registered in this deployment yet.');
  const suffix=process.env.BALLAST_PASSPORT_GENERATION?'?deployment='+process.env.BALLAST_PASSPORT_GENERATION:'';
  const response=await request.get(`/api/v2/agents/${id}/passport${suffix}`);
  expect(response.status()).toBe(200);
  const bundle=await response.json();
  expect(bundle.agent.id).toBe(id);expect(bundle.agent.executor_address).toMatch(/^0x[a-f0-9]{40}$/i);
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/agents/${id}${suffix}`);
  await expect(page.locator('h1')).toHaveText(bundle.agent.name,{timeout:60000});
  await expect(page.getByRole('region',{name:'GenLayer assessment findings'})).toBeVisible();
  await expect(page.getByText('Scope clarity',{exact:true})).toBeVisible();
  await expect(page.getByText('Spending controls',{exact:true})).toBeVisible();
  await expect(page.getByText('Observed behavior',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/ballast-v2-passport-mobile.png',fullPage:true,animations:'disabled'});
});
