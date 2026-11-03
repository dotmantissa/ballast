import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({sql:vi.fn(),start:vi.fn(),status:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../lib/server/db',()=>({db:()=>m.sql}));
vi.mock('workflow/api',()=>({start:m.start,getRun:()=>({get status(){return m.status();}})}));
vi.mock('workflow/errors',()=>({HookConflictError:{is:(e:unknown)=>!!(e as {conflictingRunId?:string})?.conflictingRunId}}));
vi.mock('../../workflows/ballast',()=>({advanceJob:vi.fn()}));
vi.mock('../../lib/server/background',()=>({saveJob:vi.fn()}));
import { launchJob } from '../../lib/server/job-queue';
beforeEach(()=>vi.clearAllMocks());
it('reuses a live run without starting a duplicate',async()=>{
  m.sql.mockResolvedValueOnce([{status:'running',run_id:'live',epoch:1,segment:0}]);m.status.mockResolvedValueOnce('running');
  expect(await launchJob('job')).toBe('live');expect(m.start).not.toHaveBeenCalled();
});
it('restarts a stranded job with a fresh epoch and token',async()=>{
  m.sql.mockResolvedValueOnce([{status:'running',run_id:'failed-run',epoch:1,segment:5}]).mockResolvedValueOnce([{status:'queued',run_id:null,epoch:2,segment:0}]).mockResolvedValueOnce([]);
  m.status.mockResolvedValueOnce('failed');m.start.mockResolvedValueOnce({runId:'new-run'});
  expect(await launchJob('job')).toBe('new-run');
  expect(m.start).toHaveBeenCalledWith(expect.anything(),['job',2,0],{hook:{token:'ballast:job:2:0'}});
});
it('preserves the epoch after uncertain admission and routes to the admitted owner',async()=>{
  m.sql.mockResolvedValueOnce([{status:'queued',run_id:null,epoch:3,segment:2}]).mockResolvedValueOnce([]);
  m.start.mockRejectedValueOnce({conflictingRunId:'admitted'});
  expect(await launchJob('job')).toBe('admitted');
});
it('does not create a second run on a metadata outage',async()=>{
  m.sql.mockResolvedValueOnce([{status:'running',run_id:'live',epoch:1,segment:0}]);m.status.mockRejectedValueOnce(Error('provider unavailable'));
  await expect(launchJob('job')).rejects.toThrow('provider unavailable');expect(m.start).not.toHaveBeenCalled();
});
it('leaves a completed job complete',async()=>{
  m.sql.mockResolvedValueOnce([{status:'complete',run_id:'done',epoch:1,segment:0}]);
  expect(await launchJob('job')).toBeNull();expect(m.start).not.toHaveBeenCalled();
});
