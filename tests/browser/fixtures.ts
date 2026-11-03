import {test as base,expect} from '@playwright/test';
export {expect};
export const test=base.extend({
  page:async({page,baseURL},provide)=>{
    const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if(bypass&&baseURL){
      const origin=new URL(baseURL).origin;
      await page.route(origin+'/**',route=>route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':bypass}}));
    }
    await provide(page);
  },
  request:async({request,playwright,baseURL},provide)=>{
    const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if(!bypass){await provide(request);return;}
    const protectedRequest=await playwright.request.newContext({baseURL,extraHTTPHeaders:{'x-vercel-protection-bypass':bypass}});
    try{await provide(protectedRequest);}finally{await protectedRequest.dispose();}
  },
});
