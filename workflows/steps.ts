import { runJobTick } from "@/lib/server/job-ticks";
import { db } from "@/lib/server/db";
import { launchJob } from "@/lib/server/job-queue";

export async function tickJob(jobId:string,epoch:number,segment:number) {
  "use step";
  console.info("ballast.workflow.tick",{jobId,epoch,segment});
  return runJobTick(jobId,epoch,segment);
}
export async function continueJob(jobId:string,epoch:number,segment:number) {
  "use step";
  const sql=db();
  // Persist the continuation before enqueueing it; Cron recovers interrupted starts.
  await sql`UPDATE ballast_jobs SET segment=${segment+1},status='queued',run_id=NULL,updated_at=now() WHERE id=${jobId} AND epoch=${epoch} AND segment=${segment} AND status NOT IN ('complete','failed')`;
  await launchJob(jobId);
}
