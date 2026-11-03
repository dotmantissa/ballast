import "server-only";
import { start, getRun } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import { advanceJob } from "@/workflows/ballast";
import { db } from "./db";
import { saveJob } from "./background";
import type { Action } from "../validation";
import { activeDeployment } from "../deployments";

export async function launchJob(jobId:string):Promise<string|null> {
  const sql=db();
  let [job]=await sql`SELECT status,run_id,epoch,segment FROM ballast_jobs WHERE id=${jobId}`;
  if(!job||job.status==='complete'||job.status==='failed')return null;
  if(job.run_id) {
    // A transient metadata outage must not create a second run.
    const status=await getRun(job.run_id).status;
    if(['pending','running'].includes(status))return job.run_id as string;
    const restarted=await sql`UPDATE ballast_jobs SET status='queued',epoch=epoch+1,segment=0,run_id=NULL,updated_at=now() WHERE id=${jobId} AND run_id=${job.run_id} AND status NOT IN ('complete','failed') RETURNING status,run_id,epoch,segment`;
    if(!restarted.length)return null;
    [job]=restarted;
  }
  let runId:string;
  try {
    const run=await start(advanceJob,[jobId,job.epoch,job.segment],{hook:{token:`ballast:${jobId}:${job.epoch}:${job.segment}`}});
    runId=run.runId;
  }catch(error){
    if(!HookConflictError.is(error)||!error.conflictingRunId)throw error;
    runId=error.conflictingRunId;
  }
  await sql`UPDATE ballast_jobs SET status='running',run_id=${runId},pause_reason=NULL,updated_at=now() WHERE id=${jobId} AND epoch=${job.epoch} AND segment=${job.segment} AND status NOT IN ('complete','failed')`;
  return runId;
}
export async function queueOperation(userId:string,operationId:string,action:Action) {
  const id=await saveJob('operation',action.deployment??activeDeployment.id,operationId,{userId,action});
  await launchJob(id);
}
export async function queueDomainJob(kind:'case'|'assessment'|'monitor',deploymentId:string,targetId:string) {
  const id=await saveJob(kind,deploymentId,targetId);
  await launchJob(id);
  return id;
}
