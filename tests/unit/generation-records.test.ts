import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../lib/server/chain',()=>({readAt:m.read,read:vi.fn(),getOverview:vi.fn()}));
import {lookupRecord,publicRecordPage} from '../../lib/server/records';
import {deploymentById} from '../../lib/deployments';
beforeEach(()=>vi.clearAllMocks());
it('keeps an earlier policy tied to its original pool after a fresh record lookup',async()=>{
  m.read.mockResolvedValueOnce({id:'a'.repeat(24),status:'active'});
  const policy=await lookupRecord('policies','a'.repeat(24),'v1-review');
  expect(policy.deployment_id).toBe('v1-review');
  expect(m.read).toHaveBeenCalledWith(deploymentById('v1-review'),'underwriting','get_policy',['a'.repeat(24)]);
});
it('rejects an unlisted pool before any record read',async()=>{
  await expect(lookupRecord('policies','a'.repeat(24),'0x'+'1'.repeat(40))).rejects.toThrow('Unknown deployment');expect(m.read).not.toHaveBeenCalled();
});

it('paginates an earlier public ledger using its own count and contract address',async()=>{
  m.read.mockResolvedValueOnce({claim_count:63}).mockResolvedValueOnce([{id:'old'}]);
  const page=await publicRecordPage('claims',undefined,'v1-original');
  expect(page.total).toBe(63);expect(page.next_cursor).toBe(13);expect(page.items[0].deployment_id).toBe('v1-original');
  expect(m.read).toHaveBeenLastCalledWith(deploymentById('v1-original'),'court','list_claims',[13,50]);
});
