import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({sql:vi.fn(),read:vi.fn(),submit:vi.fn(),sync:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../lib/server/db',()=>({db:()=>m.sql}));
vi.mock('../../lib/server/chain',()=>({readAt:m.read}));
vi.mock('../../lib/server/env',()=>({env:(name:string)=>name==='BALLAST_SPONSOR_KEY'?'0x'+'1'.repeat(64):'test-master'}));
vi.mock('../../lib/custody',()=>({encryptKey:()=> 'encrypted-test-key'}));
vi.mock('../../lib/deployments',()=>({activeDeployment:{id:'v2',assurance:'test'},deploymentById:vi.fn()}));
vi.mock('../../lib/server/operations',()=>({submitAction:m.submit,syncOperation:m.sync}));
import { sponsoredAction, stableRequestId, saveJob } from '../../lib/server/background';
const address='0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const action={kind:'finalize',claimId:'a'.repeat(24)} as const;
beforeEach(()=>{vi.clearAllMocks();m.read.mockResolvedValue({sponsor:address});});
function prepared(){m.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{address}]);}
it('keeps the same request identity across retries and distinct identities separate',()=>{
  expect(stableRequestId('same')).toBe(stableRequestId('same'));
  expect(stableRequestId('same')).not.toBe(stableRequestId('different'));
  expect(stableRequestId('same')).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});
it('returns the finalized operation without spending sponsor admission',async()=>{
  prepared();m.sql.mockResolvedValueOnce([{id:'old',kind:'finalize',status:'FINALIZED',execution:'success'}]);m.sync.mockResolvedValueOnce({id:'old',execution:'success'});
  expect(await sponsoredAction('identity',action)).toMatchObject({id:'old'});expect(m.submit).not.toHaveBeenCalled();expect(m.sql).toHaveBeenCalledTimes(3);
});
it('keeps a protocol timeout in flight instead of signing another transaction',async()=>{
  prepared();m.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'pending',status:'LEADER_TIMEOUT'}]);m.sync.mockResolvedValueOnce({id:'pending',retryable:false});
  expect(await sponsoredAction('identity',action)).toBeNull();expect(m.submit).not.toHaveBeenCalled();
  const query=m.sql.mock.calls[3][0].join('?');expect(query).not.toContain('LEADER_TIMEOUT');
});
it('does not sign when atomic daily admission is exhausted or another lease exists',async()=>{
  prepared();m.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect(await sponsoredAction('identity',action)).toBeNull();expect(m.submit).not.toHaveBeenCalled();
  expect(m.sql.mock.calls[5][0].join('?')).toContain('used_count<');expect(m.sql.mock.calls[5]).toContain(20);
});
it('makes monitoring yield to a ready claim',async()=>{
  prepared();m.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'claim-job'}]);
  expect(await sponsoredAction('monitor',{kind:'assess',agentId:'a'.repeat(24),evidenceUrls:['https://a.com','https://b.com'],publicConsent:true})).toBeNull();expect(m.submit).not.toHaveBeenCalled();
});
it('preserves pending job payload when a daily dispatch repeats',async()=>{
  m.sql.mockResolvedValueOnce([]);await saveJob('monitor','v2','agent');
  const query=m.sql.mock.calls[0][0].join('?');expect(query).toContain('ELSE ballast_jobs.payload');expect(query).toContain('ballast_jobs.epoch+1');
});

it('refuses premiums, bonds, consent and capital before opening sponsor custody',async()=>{
  for(const action of [{kind:'bind',quoteId:'a'.repeat(24)},{kind:'monitor',agentId:'a'.repeat(24),enabled:true},{kind:'withdraw'},{kind:'stake',tranche:'junior',amount:'1'}] as const)await expect(sponsoredAction('unsafe',action)).rejects.toThrow('account holder submission');
  expect(m.sql).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
});
